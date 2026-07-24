import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../src/client/term.ts", import.meta.url), "utf8");
const remote = readFileSync(new URL("../src/server/terms.ts", import.meta.url), "utf8");
const channel = readFileSync(new URL("../src/server/channel-computers.ts", import.meta.url), "utf8");

test("terminal UI heartbeats and silently reconnects the same session", () => {
  assert.match(client, /setInterval[\s\S]*type:\s*"ping"/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /window\.addEventListener\("online"/);
  assert.match(client, /scheduleReconnect\(pane/);
  assert.match(client, /event\.code === 4004[\s\S]*sessionId = null/);
  assert.doesNotMatch(client, /terminal disconnected/);
});

test("both terminal backends answer browser heartbeat without touching the PTY", () => {
  assert.match(remote, /msg\.type === "ping"[\s\S]*type: "pong"/);
  assert.match(channel, /message\.type === "ping"[\s\S]*type: "pong"/);
});
