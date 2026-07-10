# ⌘ CTRL PANE

A lightweight, self-hosted **Slack alternative** with a native **bring-your-own-key AI bot** and **integrated split-pane terminals**. The whole thing is ~1,700 lines of TypeScript — no heavyweight frameworks, no Electron, no build-time magic on the server.

Multi-channel chat · threads · DMs · drag-and-drop files · admin panel · notification sounds · context-aware AI bots with per-channel/per-thread model selection · WebSocket terminals with server-side keep-alive · one-to-many bot→computer assignment.

---

## Why it's small

| Piece | How |
|---|---|
| **Runtime** | Node 22 runs the server's TypeScript **directly** (native type-stripping) — no `tsc`/`ts-node` build step for the backend. |
| **Database** | `node:sqlite` (built into Node) — no ORM, no external DB. |
| **Server** | `node:http` + `ws`. No Express, no Nest. |
| **Terminals** | `node-pty` + an embedded [Open Terminal](https://github.com/open-webui/open-terminal)-compatible agent. |
| **Client** | Vanilla TS bundled with esbuild + Tailwind v4. `xterm.js` only for terminals. |

Total dependencies at runtime: **`ws`** and **`node-pty`**. That's it.

## Quick start

```bash
npm install
npm run build      # bundles the client (esbuild) + Tailwind CSS
npm start          # serves on http://localhost:8123
```

Open `http://localhost:8123`. **The first account you create becomes the admin.**

Want it to feel like a desktop app? Point Chrome at it:

```bash
google-chrome --app=http://localhost:8123
```

### Dev mode (auto-rebuild the client)

```bash
npm run watch:js   # terminal 1
npm run watch:css  # terminal 2
npm start          # terminal 3
```

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8123` | HTTP/WebSocket port. |
| `CTRL_DATA_DIR` | `./data` | SQLite DB + uploaded files. |

On first boot CTRL PANE starts a private, loopback-only Open-Terminal agent and registers it as the **"This Computer"** computer, so terminals and bot commands work out of the box.

---

## Features

### Chat
- **Channels** (public), **DMs** (private), and **threads** on any message.
- **Slack-style message list** — avatar/name grouping for consecutive messages, sticky date dividers, hover actions, reply counts with "last reply" time.
- **Light & dark themes** — toggle in the sidebar header; respects your OS preference on first load and persists your choice. Terminals recolor with the theme too.
- **Drag-and-drop file sharing** — drop files on the composer, or use the attach button. Images render inline.
- **Notification sounds** — synthesized in the browser (no asset files); a distinct chirp for @mentions.
- **Unread badges**, `@mention` autocomplete, Markdown rendering.

### AI bots (bring your own key)
Add a bot in **Settings → Bots** with just a **base URL** and **API key** for any OpenAI-compatible endpoint. Click **Fetch** to pull the model list.

- **Three-level model routing** with inheritance: **thread → channel → global**. Open the **Models** button in a channel header or thread panel to get a routing card that shows all three levels at once, highlights which one is *active here*, shows the effective model ("Serving here: …"), and lets you set or clear each level independently (clearing falls back to the parent).
- **Slack-style add flow** — `@mention` a bot that isn't in the channel and you're prompted *"Add @bot to #channel?"*.
- **Context awareness**:
  - Mention it **in a thread** → it receives the **full thread context**.
  - Mention it **in a channel** → **fresh session, no context**.
- **Bots only ever reply in threads.** Mention one at the top level of a channel and it opens a thread under your message rather than speaking in the channel.

### Computers & terminals
- **Computers** (Settings → Computers) are [Open Terminal](https://github.com/open-webui/open-terminal) endpoints — again, just **base URL + API key**.
- **Integrated terminal workspace** with **split panes** (split right / split down / close). Each pane is a live PTY over WebSocket.
- **Keep-alive**: the server owns the upstream PTY connection and buffers scrollback, so sessions survive tab closes and reconnects, and are pinged so they don't die when idle.
- **Assign computers to bots** (one-to-many) in the bot editor. The bot's system prompt then lists its computers and states that *the user has granted full permission to act on their behalf*; the bot runs commands via a `run_command` tool and reports back.

### Admin
- First user is admin. Admins manage bots, computers, and members (promote/demote/remove) in **Settings → Members**.

---

## Architecture

```
src/
  server/
    index.ts     HTTP + WebSocket server, REST API, auth, routing
    db.ts        node:sqlite schema, password hashing, helpers
    store.ts     message/model-pref/bot helpers, 3-level model resolution
    bots.ts      OpenAI-compatible streaming + tool-call loop
    computer.ts  client for Open-Terminal computers (exec, terminals, models)
    terms.ts     keep-alive terminal session manager (upstream ↔ many browsers)
    events.ts    membership-scoped live event fan-out
    agent.ts     embedded Open-Terminal-compatible PTY/exec agent
  client/
    app.ts       auth, layout, sidebar, messages, threads, composer, mentions
    settings.ts  settings/admin modal + reusable model picker
    term.ts      split-pane xterm workspace
    dom.ts       tiny hyperscript, safe Markdown, notification sounds
    api.ts       REST + WebSocket client
```

### Notable design choices
- **The embedded agent speaks the real Open-Terminal protocol**, so "This Computer" and any external Open-Terminal instance are reached through one client — no special-casing local vs remote.
- **Model resolution lives in one function** (`resolveModel`) used by both the bot pipeline and mirrored in the client picker.
- **Terminal keep-alive** is a fan-out proxy: one upstream WebSocket per session, N browser clients, a bounded scrollback ring replayed on attach.

## Testing

```bash
# backend pipeline (uses a bundled mock OpenAI endpoint; needs no extra deps)
node test/mock-openai.mjs 9099 &
npm start &
node test/pipeline.mjs      # model inheritance, context rules, tool calls
node test/term.mjs          # terminal WebSocket round-trip

# full browser UI test (optional — needs puppeteer)
npm i -D puppeteer && npx puppeteer browsers install chrome
node test/ui.mjs
```

## Security notes
- Passwords are hashed with scrypt; sessions are random bearer tokens.
- A bot assigned a computer can run arbitrary shell commands on it — that is the point. Only assign computers you trust the bot (and its provider) to operate.
- The embedded agent binds to `127.0.0.1` only.

## License
MIT
