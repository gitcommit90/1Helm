# 1Helm

**1Helm productizes self-hosting.** It gives someone who owns a computer or VPS a conversational control plane instead of requiring them to learn terminals, SSH, reverse proxies, Docker, and scattered SaaS dashboards.

The workspace looks familiar — channels, threads, DMs — but channels are operational objects:

- People can create ordinary channels freely.
- Every deployed app gets its own dedicated channel and agent.
- `@skipper` in `#main` is the chief of staff: the workspace-level assistant that coordinates the system.

The first compelling demo is simple: ask the workspace to make something useful, then open the resulting service from another device.

Distribution for now is fully OSS and self-hosted. State lives on the user's machine in local SQLite. Users bring their own AI provider. A managed hosted offering is a future layer; this repository is the on-box workspace runtime.

Living product record: [`docs/VISION.md`](docs/VISION.md).

---

## What works today

- **First-run wizard** — create the owner account, connect an AI brain, choose terminal access, name the workspace, land in `#main`.
- **`@skipper`** — seeded chief-of-staff bot with a canned welcome (no model wait on first impression).
- **Chat** — channels, DMs, threads, Markdown, file uploads, unread badges, light/dark themes.
- **AI providers** — OpenAI-compatible base URL/key, OpenRouter OAuth (HTTPS/localhost), Login with ChatGPT.
- **Bots** — BYOK OpenAI-compatible bots, three-level model routing (thread → channel → global), context-aware replies.
- **Terminals** — optional. Hidden unless enabled during setup; powered by an embedded Open-Terminal-compatible agent + `node-pty`.

Not yet shipped: app catalog, one-click deploy, Uptime Kuma as the first reference app, consumer installer, HTTPS/tunnel story.

---

## Quick start

```bash
# Prefer the official Node 22 binary (some distro builds omit TypeScript support)
PUPPETEER_SKIP_DOWNLOAD=1 npm install
npm run build      # client bundle + Tailwind CSS
npm start          # http://localhost:8123
```

Open `http://localhost:8123`. On a fresh data directory you should see the setup wizard, not a login screen:

1. Create the owner account (first user is admin).
2. Connect an AI provider.
3. Choose whether terminals appear in the sidebar.
4. Name the workspace.
5. Land in `#main` with `@skipper`.

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8123` | HTTP/WebSocket port. |
| `CTRL_DATA_DIR` | `./data` | SQLite DB + uploaded files (internal path name kept for compatibility). |

On first boot 1Helm starts a private loopback Open-Terminal agent and registers it as **"This Computer"** so terminals and bot commands work when terminals are enabled.

### Dev mode

```bash
npm run watch:js   # terminal 1
npm run watch:css  # terminal 2
npm start          # terminal 3
```

### Desktop-app feel

```bash
google-chrome --app=http://localhost:8123
```

---

## Architecture

Compact Node/TypeScript app — no Electron, no server transpile step:

| Piece | How |
|---|---|
| **Runtime** | Official Node 22 runs server TypeScript directly (native type-stripping). |
| **Database** | `node:sqlite` — no ORM, no external DB. |
| **Server** | `node:http` + `ws`. |
| **Client** | Vanilla TypeScript via esbuild + Tailwind CSS. |
| **Terminals** | `node-pty` + embedded Open-Terminal-compatible agent. |

```
src/
  server/
    index.ts      HTTP + WebSocket, REST API, auth
    db.ts         schema, password hashing
    setup.ts      workspace setup, #main, @skipper seed
    store.ts      messages, model prefs, bots
    bots.ts       OpenAI-compatible streaming + tools
    computer.ts   Open-Terminal client
    terms.ts      keep-alive terminal sessions
    events.ts     live event fan-out
    agent.ts      embedded local terminal agent
  client/
    app.ts        boot, auth, layout, chat
    onboarding.ts first-run wizard
    settings.ts   settings + provider OAuth
    term.ts       split-pane xterm workspace
    dom.ts        hyperscript, Markdown, sounds
    api.ts        REST + WebSocket client
```

Runtime deps: `ws`, `node-pty`, and the optional ChatGPT login package.

---

## Features in more detail

### Chat
Channels, DMs, threads, Slack-style grouping, light/dark themes, drag-and-drop uploads, notification sounds, unread badges, `@mention` autocomplete, Markdown.

### AI bots
Add bots in **Settings → Bots** with any OpenAI-compatible base URL + API key. Model routing inherits **thread → channel → global**. Bots reply in threads only. Mentioning a bot that is not in the channel prompts to add it.

### Computers & terminals
Computers are Open-Terminal endpoints. Terminals are optional and can stay hidden. Assigned computers give bots a `run_command` tool; only assign machines you trust the bot and its provider to operate.

### Admin
First user is admin. Admins manage bots, computers, providers, and members.

---

## Testing

```bash
node test/mock-openai.mjs 9099 &
npm start &
node test/pipeline.mjs      # model inheritance, context rules, tool calls
node test/term.mjs          # terminal WebSocket round-trip

# full browser UI test (optional)
npm i -D puppeteer && npx puppeteer browsers install chrome
node test/ui.mjs
```

## Security notes
- Passwords: scrypt. Sessions: random bearer tokens.
- A bot assigned a computer can run shell commands on it — that is intentional.
- The embedded agent binds to `127.0.0.1` only.

## License
MIT
