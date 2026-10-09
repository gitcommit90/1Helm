<p align="center">
  <img src="app-assets/1helm-icon.png" alt="1Helm sailboat" width="88" height="88">
</p>

<h1 align="center">1Helm</h1>

<p align="center">
  <strong>Your personal AI workspace. Your Cloudflare account. Your AI provider.</strong>
</p>

<p align="center">
  <a href="https://deepwiki.com/gitcommit90/1Helm"><img src="https://devin.ai/assets/askdeepwiki.png" alt="Ask DeepWiki" height="20"></a>
</p>

<p align="center">
  <a href="#first-install">Get started</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/backup-restore.md">Backup &amp; restore</a> ·
  <a href="#source-map">Explore the source</a>
</p>

---

1Helm is a personal AI workspace on Cloudflare. This repository contains the Worker, web app, channel computer image, and optional phone and desktop clients. You can deploy the core product to your own Cloudflare account and use your own AI provider key. Your account pays for its own Cloudflare and provider usage.

## A workspace, not just a chat

- **Keep context across tasks.** Channels bring together conversations, memory, and a Notebook for the things you want your assistant to remember.
- **Give your agent a computer.** Run code and work with files in a channel computer hosted on Cloudflare, with a persisted workspace.
- **Bring your own AI.** Connect an OpenAI-compatible provider using your own endpoint, model, and key.
- **Use it across your devices.** Open the web app or PWA on your own host; optional [phone and desktop clients](apps/README.md) connect over HTTPS.

> **This is the Cloudflare edition.** The public install is a single-owner server: the first email address to sign in becomes its owner; later addresses cannot register. It is a fresh install, not an in-place upgrade of the older Linux-server product.

## License and scope

The core is [AGPL-3.0-only](LICENSE). Source under [`src/ee/`](src/ee/), [`src/skills/ee/`](src/skills/ee/), and [`web/src/ee/`](web/src/ee/) is separately licensed under [`ee/LICENSE`](ee/LICENSE). It is included for source visibility and disabled in public installs. **Do not set `ONEHELM_EE`;** it is reserved for 1HC's private deployment.

## Requirements

- Node.js 22 or newer, npm, and Docker with a running daemon. Wrangler builds the channel computer container during deployment.
- A Cloudflare Workers Paid account with Workers, D1, R2, Workers AI, Browser Run, Images, Containers, and Email Service enabled. [Containers](https://developers.cloudflare.com/containers/) and [Email Sending](https://developers.cloudflare.com/email-service/) require Workers Paid.
- A domain using Cloudflare DNS, onboarded to [Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/), and a sender address on that domain. Email delivery is required to claim the owner account. Cloudflare says DNS setup can take time to propagate; finish it before running setup.
- A `workers.dev` subdomain on your account and its 32-character account ID from the Cloudflare dashboard.
- An AI service with an OpenAI-compatible chat completions API and your own key. You enter the key in the app after signing in.

## First install

### 1. Deploy to your Cloudflare account

```sh
git clone https://github.com/gitcommit90/1Helm.git
cd 1Helm
npm ci
npx wrangler login
npm run setup
```

`setup` asks for a Worker name, the exact `<worker>.<your-subdomain>.workers.dev` host, an Email Service sender address, a support email, and the Cloudflare account ID. It checks Docker and Wrangler access, installs the web build dependencies, checks the migration sequence, creates a new D1 database and R2 bucket, applies the schema, builds the web app, generates a vault key and Web Push keys, and deploys the Worker.

### 2. Keep your recovery secrets safe

Setup writes your private `wrangler.jsonc` locally and saves recovery secrets at `~/.config/onehelm/<worker>-recovery.json` with owner-only permissions.

> **Keep an encrypted offline copy of the recovery file.** Losing `VAULT_KEY` makes saved secrets and shared-link keys unusable.

### 3. Sign in and connect your AI

Open the deployed host, sign in with the first email address, then set your AI provider endpoint, key, and model in **Settings → Your AI → Use my own AI key**. Start with a chat, web search, and a channel computer task. The web app and PWA use your host. The native apps in `apps/` default to 1HC and can be pointed at a custom HTTPS host.

### If setup is interrupted

Do not rerun setup with the same names after it has created remote resources. Inspect the resources with `npx wrangler d1 list --json` and `npx wrangler r2 bucket list`, then continue the remaining steps manually using [configuration](docs/configuration.md). `wrangler.jsonc` and the recovery file identify this installation.

[Cloudflare deploys the Worker before its container image](https://developers.cloudflare.com/containers/guides/deploy/), so a failed image build can leave the Worker reachable while computer tasks fail. After a successful deploy, run a task that uses the channel computer before relying on it.

## Updating

Read [backup and restore](docs/backup-restore.md) and the [upgrade instructions](docs/upgrade.md). Back up Durable Object state, D1, R2, and the recovery secrets before changing code. Then run:

```sh
npm ci
npm ci --prefix web
npm run check:migrations
npm run deploy
```

The deploy command rebuilds the web app, applies pending D1 migrations to the configured remote database, and deploys the Worker. It does not create a new database or bucket. Never point this schema at an old 1Helm Linux installation's database; that product requires a fresh install.

## Source map

| Area | Start here |
| --- | --- |
| Worker and agent runtime | [`src/index.js`](src/index.js) |
| Web app | [`web/src/`](web/src/) — source; `app-assets/app-static/` is generated by `npm run build` |
| Channel computer image | [`image/Dockerfile`](image/Dockerfile) |
| Database | [`db/migrations/`](db/migrations/) — ordered D1 schema |
| Phone and desktop clients | [`apps/`](apps/README.md) |

For operating your install, read [configuration and secrets](docs/configuration.md), [backup and restore](docs/backup-restore.md), and [upgrading](docs/upgrade.md). For changes to the code, start with the [forking instructions](AGENTS.md).

### Local checks

After `npm ci`, run `npm run test:core` to check the cloud-feature switch, owner sign-in, mobile compatibility, own-key enforcement, published-page source safety, storage and usage accounting locally. After `npm ci --prefix web`, run `npm run test:web` to check the public key and storage screens and the 1HC billing variants. `npm run check:migrations` checks the fresh database schema.
