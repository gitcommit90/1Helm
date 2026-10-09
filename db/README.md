# D1 migrations

`migrations/` is the ordered schema for a new deployment. It starts from the full schema snapshot at `0001` because the older root `migrations_001`–`011` files were incremental changes to 1HC's existing database and cannot be replayed on an empty database. Every later migration is copied in filename order, including those with duplicate old number prefixes. The full filename is the migration identity.

The public Wrangler config sets `migrations_dir` to `db/migrations`. Apply it with `wrangler d1 migrations apply DB --remote --config wrangler.jsonc` after creating the D1 database and before deploying the Worker. Wrangler records applied filenames and rolls back a failed migration. For local development, replace `--remote` with `--local`.

Add future changes as the next numbered `.sql` file. Never edit an already applied migration; add a new one instead. Run `node scripts/check-migrations.mjs` against the full set before publishing.
