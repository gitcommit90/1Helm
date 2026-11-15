# Working on 1Helm

- Read `README.md`, `docs/configuration.md`, and the relevant source before editing. The Worker is `src/index.js`; web source is `web/src/`; `app-assets/app-static/` is generated.
- Keep core features usable with `ONEHELM_EE` unset. Cloud-only code stays in `src/ee/`, `src/skills/ee/`, and `web/src/ee/` under `ee/LICENSE`. Do not add a runtime license service or enable those modules in the public config.
- Never commit `wrangler.jsonc`, `.env`, `.dev.vars*`, recovery secrets, Cloudflare IDs, provider keys, or test accounts. The example config is the only Wrangler config tracked.
- Add D1 changes as the next numbered file in `db/migrations/`; run `npm run check:migrations` against a fresh local schema. Back up production data before `npm run deploy`.
- Build the web app with `npm ci --prefix web && npm run build`. Keep the source and generated assets in sync. Keep native client packages in `apps/` separate from the Worker build.
- Fork and change core code under the root AGPL license. The process for accepting outside pull requests is still undecided. Changes to `ee/` have separate terms; read `ee/LICENSE` first.
