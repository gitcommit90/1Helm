# Upgrading

Use the same Cloudflare account, D1 database, R2 bucket, Worker name, Durable Object namespaces, app host, and `VAULT_KEY` throughout an upgrade. Do not run `npm run setup` again. Before changing source, follow [backup and restore](backup-restore.md) and record the commit you are upgrading from. Keep the existing namespaces intact; the cross-account restore path still needs a live rehearsal.

After reviewing new migration files and changes to `wrangler.example.jsonc`, bring any new required bindings or variables into your private `wrangler.jsonc`. Run `npm ci`, `npm ci --prefix web`, `npm run check:migrations`, then `npm run deploy`. The deploy script applies only pending D1 migrations and rebuilds the app. Confirm sign-in, one chat, a file, and the channel computer after the new Worker is active.

When changing the channel computer Dockerfile, Wrangler builds a new container image at deploy time; a working Docker daemon is required. Existing D1 and R2 data stay in Cloudflare. Do not import a legacy v1.x Linux database into this Worker: the schema and runtime are different, so use a fresh installation.
