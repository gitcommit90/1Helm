# Upgrading

Use the same Cloudflare account, D1 database, R2 bucket, Worker name, Durable Object namespaces, app host, and `VAULT_KEY` throughout an upgrade. Do not run `npm run setup` again. Before changing source, follow [backup and restore](backup-restore.md) and record the commit you are upgrading from. Keep the existing namespaces intact; the cross-account restore path still needs a live rehearsal.

After reviewing new migration files and changes to `wrangler.example.jsonc`, bring any new required bindings or variables into your private `wrangler.jsonc`. Run `npm ci`, `npm ci --prefix web`, `npm run check:migrations`, then `npm run deploy`. The deploy script applies only pending D1 migrations and rebuilds the app. Confirm sign-in, one chat, a file, and the channel computer after the new Worker is active.

When changing the channel computer Dockerfile, Wrangler builds a new container image at deploy time; a working Docker daemon is required. Existing D1 and R2 data stay in Cloudflare. Do not import a legacy v1.x Linux database into this Worker: the schema and runtime are different, so use a fresh installation.

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
