# Upgrading

Use the same Cloudflare account, D1 database, R2 bucket, Worker name, Durable Object namespaces, app host, and `VAULT_KEY` throughout an upgrade. Do not run `npm run setup` again. Before changing source, follow [backup and restore](backup-restore.md) and record the commit you are upgrading from. Keep the existing namespaces intact; the cross-account restore path still needs a live rehearsal.

After reviewing new migration files and changes to `wrangler.example.jsonc`, bring any new required bindings or variables into your private `wrangler.jsonc`. Run `npm ci`, `npm ci --prefix web`, `npm run check:migrations`, then `npm run deploy`. The deploy script applies only pending D1 migrations and rebuilds the app. Confirm sign-in, one chat, a file, and the channel computer after the new Worker is active.

When changing the channel computer Dockerfile, Wrangler builds a new container image at deploy time; a working Docker daemon is required. Existing D1 and R2 data stay in Cloudflare. Do not import a legacy v1.x Linux database into this Worker: the schema and runtime are different, so use a fresh installation.

## October 28 source update, custom sections, Back and Forward arrows, and licensed model and Bee library code

Apply ordered D1 migrations `0064` and `0065` using the normal migration runner. Each one only adds two columns to `tenants` (`custom_models_on` and `custom_models`, then `custom_models_own_on` and `custom_models_own`), all with defaults that change nothing for an existing account. Run `npm ci --prefix web` and `npm run build` again. No new binding or variable is required, and the example configuration is unchanged.

Every channel can now group its tasks into custom sections (`src/sections.js`, `GET` and `POST /w/<slug>/api/res/<channel>/sections`), which the owner turns on, names, colors, reorders and fills. The section list is kept in the channel's own storage, a task with no section stays under Uncategorized, and the order inside a group follows the latest activity. The app also gets Back and Forward arrows beside the logo (Mod+[ and Mod+] as keys) that follow the address history, and the text of an unsent message is kept for each composer until the message is sent.

The licensed code under `src/ee/` and `web/src/ee/` has three additions that run only when `ONEHELM_EE` is `1hc`. Custom Model Selection (`src/ee/custom-models.js` and `src/ee/byok-custom.js`) lets an account choose its own chain of chat models for each category, with its own key or with the service's models. Bee conversations in the Library (`src/ee/bee-library.js`) lists, reads, exports and deletes the saved Bee conversations of the owner. Switch now on the own key plan is part of the billing code. An install without `ONEHELM_EE` does not reach any of these routes, and the new account fields are not sent to its app.

The speech jobs now wait for a cold speech container when the job's time limit leaves room and the container model is the last choice, a Workers AI speech model with a saved price per second is charged by that price, and a Workers AI speech call is tried once. A repeated SSH approval request for the same host, user, port and task now returns the card that is already waiting instead of making another. The channel computer has a small `GET` route for its activity, which the app reads to show when the computer is working.

## October 26 source update, ranked task search and Bee speaker answers

The sidebar and phone drawer Search box now asks the Worker to rank every task in the channel after a short pause (`GET /w/<slug>/api/res/<channel>/search?q=...`, owner only, at most 30 results). The ranking merges a keyword ranking (SQLite FTS5 in the channel's own storage) with a meaning ranking made from one embedding per task, also kept in the channel's own storage, so it needs no new binding, variable or D1 migration. Nothing is indexed until someone searches the channel. The meaning side uses the `mem_embed` model job and needs the `AI` binding; without it, or when the person's credits cannot cover the embedding, the keyword ranking answers alone. In `TEST_MODE` only, adding `debug=1` to the route shows the index and the raw meaning scores.

A named Bee speaker label whose review ends with no contact (Accept, a name with no match, or Not them to every match) is now remembered per account, so the same label does not make another New speaker card, and waiting cards with that label leave with the answer. A file the helper shares under a name with no extension now keeps its source file's extension, and the file's video and audio extensions are known to the Library. A done task no longer reports waiting, and marking a task done ends its pending approvals and spend check-ins. The Zone slide strip shows each slide fully drawn, and the deck check refuses text that stays invisible. An SSH request now checks the computer's network state first: when the tailnet is not joined, `ssh_connect` returns setup steps with a link to Settings, Computer connections, and the primary helper keeps the SSH tools when a request would otherwise go to a worker. Memory search now asks Vectorize for more matches than a page needs, and the ids of deleted memory vectors are kept in a small D1 table, `mem_vec_gone` (ids only, never text), that the Worker creates the first time a memory delete runs. The scheduled deletion run deletes those vectors from Vectorize again after 2, 10 and 30 minutes, because Vectorize can apply a write after a delete that was sent before it. Run `npm ci` and `npm run build` again. No D1 migration is required.

## October 25 source update, HTML slide decks, the Zone and long messages

The artifacts skill now builds a slide deck as an HTML file from one of 34 vendored templates (with matching PDF and editable PowerPoint export), and the app has a deck style picker. The templates, their fonts and their text width tables are static files under `app-assets/deck-templates/`, which the Worker reads through the `ASSETS` binding and never serves on a public route, so the new files add about 830 files and 10 MB to the assets directory. The template licenses are in `app-assets/deck-templates/LICENSE`, `app-assets/deck-templates/_measure/` and `licenses/`. The deck style picker thumbnails are in `app-assets/app-static/deck-styles/`.

The web build now also writes `app-assets/app-static/zone/zone.js` and `zone-ui.css`, which the app loads only when a file is opened in the Zone (decks, pages, reports and Word `.docx` files next to the chat, with direct edits saved back as a new version). `zone/imgfx.js` is a prebuilt third party file that is committed and not built. Run `npm ci` and `npm run build` again. Text that reaches a channel and is longer than 100,000 characters is now saved as a Markdown file in the channel and sent as an attachment instead of being refused. The request body limit of the chat routes is still 64 KB on a self-hosted install, so a message that large is still refused at the route before this applies. The Google Slides route for decks is part of the licensed connected apps code, so an install without `ONEHELM_EE` always builds the HTML deck. No D1 migration, binding or variable is required, and the example configuration is unchanged.

## October 23 source update, speech container and speaker labels

The Worker now exports a `SpeechContainer` Durable Object class (`src/speech-container.js`) that runs speech models in a container, and the first run settings list those models first for the jobs "Speech to text" and "Live dictation" and add the job "Speaker labels". The example configuration does not define a `SPEECH_CONTAINER` binding, a container entry or a migration for it, the same as `PrepContainer`, so an install that does nothing keeps working: with no binding, a step that names a model starting with `@1hc/` fails at once with the error "No speech container is available on this server", and the next model of the job answers. The saved settings of an existing install are not rewritten. To run the speech models yourself, add a `SPEECH_CONTAINER` binding with class `SpeechContainer`, a container entry that builds `image/speech/Dockerfile` on the `standard-4` instance type with scheduling policy `durable_object`, and a migration with `"new_sqlite_classes": ["SpeechContainer"]` to your private `wrangler.jsonc`. Set the variable `SPEECH_MAX_INSTANCES` to the most containers that may run at once (each uses 4 vCPU). Speaker labels for Live notes and for audio and video files are part of the licensed code and run only when `ONEHELM_EE` is `1hc`. No D1 migration is required. Also run `npm ci` and `npm run build` again.

## October 22 source update, BeeContainer removed

The `BeeContainer` class is no longer exported by the Worker, because the Bee calls run in the Worker and no Bee job uses a container. The example configuration never defined a `BEE_CONTAINER` binding, a Bee container definition or a `BeeContainer` migration, so an install that never added them needs no change. If you added them yourself, remove the `BEE_CONTAINER` binding and its container definition from your private `wrangler.jsonc` and add a new migration with `"deleted_classes": ["BeeContainer"]` before you deploy, because Cloudflare refuses a deploy that drops a Durable Object class that still has a migration or binding. No D1 migration is required.

## October 21 source update, memory on Mem0

Apply ordered D1 migration `0063` using the normal migration runner. It only adds the tables `mem`, `mem_history` and `mem_fts` (with three triggers that keep the keyword index in step), so an install that never turned memory on is unaffected. Run `npm ci` again, because `mem0ai` 3.3.1 is a new dependency and the repository now has a `.npmrc` that sets `legacy-peer-deps`. Copy the `alias` list and the `MEM0_TELEMETRY` variable from `wrangler.example.jsonc` into your private `wrangler.jsonc`, since the Worker does not bundle without the list.

Memory no longer uses a Hindsight server. If you ran memory on Hindsight, the `HINDSIGHT` binding, the secret `HINDSIGHT_API_KEY` and the variable `MEMORY_BACKEND` are no longer read, and your Hindsight banks are not read or deleted. To keep memory on, follow the Memory paragraph of [configuration](configuration.md) to create the Vectorize index and add the `MEMORY_INDEX` binding. The first time a channel is used, the Worker writes that channel's own records (notes, files, conversations and so on) into its new memory once. Without the `MEMORY_INDEX` binding memory stays off and nothing else changes.

## October 17 source update, model calls and limits

Apply ordered D1 migrations `0058` through `0060` using the normal migration runner. Migration `0058` adds the `model_served` table, which records what answered each saved model job and is only written by the Cloud-only Models page code. Migrations `0059` and `0060` use `DROP TABLE IF EXISTS` for the tables of the removed router experiments and the removed memory use shadow (`router_pool`, `router_shadow`, `decision_shadow`, the `router_lab_*` tables and `memory_shadow`). Only a Cloud (`ONEHELM_EE`) development deployment ever wrote those tables, so a self-hosted install loses no data. No new binding, variable or Durable Object migration is required.

The variables `OWN_ROUTER`, `OWN_ROUTER_CLEF`, `ROUTER_MODE`, `ROUTER_LAB`, `DECISION_SHADOW`, `CHORE_MODEL_LABEL`, `CHORE_MODEL_BROWSER`, `DYNAMIC_ROUTING_ZDR_THIRD_MODEL`, `DYNAMIC_ROUTING_SHARED_OR`, `TEST_MODEL`, `MODEL` and `HS_USE_SHADOW` are no longer read. You can delete them from your private `wrangler.jsonc`. The example configuration never set them. A deployment without `ONEHELM_EE` uses the built-in first-run model settings, and the backup chat job runs on Workers AI.

## October 16 source update

Apply ordered D1 migration `0057` using the normal migration runner. It only adds
the `native_text_polls` table, which the Cloud-only texting module uses, so a
self-hosted install without `ONEHELM_EE` is unaffected. No new binding, variable
or Durable Object migration is required. The `PrepContainer` and `BeeContainer`
classes are exported by the Worker but stay unused until you add their bindings,
container definitions and migrations yourself, and `DYNAMIC_ROUTING` has no effect
without `ONEHELM_EE`.

## October 15 source update

Apply ordered D1 migrations `0051` through `0056` using the normal migration
runner. They only add tables and columns, and the Worker also creates its own
tables when they are missing. Migration `0056` adds the on and off switch for
agent check-ins. It is off until the owner turns it on in Settings, so a
deployment does not start asking for check-ins by itself.

Memory now needs a Hindsight service. The example configuration does not set
`MEMORY`, so memory stays off and nothing changes for an install that never
turned it on. If you set `MEMORY` to `on` earlier, the old local memory ledger is
gone and recall stays empty until you add a `HINDSIGHT` binding to your own Hindsight server,
the secret `HINDSIGHT_API_KEY` and `MEMORY_BACKEND` set to `hindsight`. Existing ledger
tables stay in storage and are not read. Audio conversion stays off unless
`AUDIO_CONVERT` is `on`. No new binding, variable or Durable Object migration is
required otherwise.

## October 13 source update

Apply ordered D1 migration `0050` using the normal migration runner. It adds the
`model_job_settings_versions` table, which only the Cloud-only Models page uses,
so a self-hosted install without `ONEHELM_EE` is unaffected. No new binding,
variable or Durable Object migration is required.

## October 11 source update

Apply ordered D1 migrations `0041` through `0049` using the normal migration
runner. They include SSH permissions, check-in settings, age acknowledgement,
Cloud-only connection/model settings tables, and keyboard shortcuts. Existing
SSH permissions default to Deny; deploying does not authorize a connection.

Copy the new `NATIVE_TRANSPORT` binding, `NativeTransport` container definition,
`selfhost-native-transport-v1` Durable Object migration, and `NATIVE_NETWORK`
variable from the example config into your existing private config. Preserve
the original `selfhost-v1` migration and all existing namespaces. The new broker
container builds from `native-transport/Dockerfile`; it is separate from the
channel computer image. `CONTEXT_LAYOUT="v2"` enables the updated context format.

The first deployment introducing a Durable Object class must use `wrangler
deploy` (as `npm run deploy` does), not `wrangler versions upload`. A deployment
can activate the Worker before its container finishes building. If that stage
fails, fix the image/build and deploy forward while retaining the new migration
and namespace; do not remove the migration or delete namespaces to roll back.
Verify the new transport starts in your account before enabling SSH for a
channel. The source publication itself does not deploy or connect any machine.
