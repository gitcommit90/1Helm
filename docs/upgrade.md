# Upgrading

Use the same Cloudflare account, D1 database, R2 bucket, Worker name, Durable Object namespaces, app host, and `VAULT_KEY` throughout an upgrade. Do not run `npm run setup` again. Before changing source, follow [backup and restore](backup-restore.md) and record the commit you are upgrading from. Keep the existing namespaces intact; the cross-account restore path still needs a live rehearsal.

After reviewing new migration files and changes to `wrangler.example.jsonc`, bring any new required bindings or variables into your private `wrangler.jsonc`. Run `npm ci`, `npm ci --prefix web`, `npm run check:migrations`, then `npm run deploy`. The deploy script applies only pending D1 migrations and rebuilds the app. Confirm sign-in, one chat, a file, and the channel computer after the new Worker is active.

When changing the channel computer Dockerfile, Wrangler builds a new container image at deploy time; a working Docker daemon is required. Existing D1 and R2 data stay in Cloudflare. Do not import a legacy v1.x Linux database into this Worker: the schema and runtime are different, so use a fresh installation.

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
