import test from "node:test";
import assert from "node:assert/strict";

const original = {
  WebSocket: globalThis.WebSocket,
  document: globalThis.document,
  location: globalThis.location,
  localStorage: globalThis.localStorage,
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen = null;
  onmessage = null;
  onclose = null;
  sent = [];
  closeCode = null;
  constructor(url) { this.url = url; FakeWebSocket.instances.push(this); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.({}); }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close(code) { this.closeCode = code; this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code }); }
}

test("main event connection replaces a ghost OPEN socket after foregrounding", async () => {
  const storage = new Map();
  globalThis.WebSocket = FakeWebSocket;
  globalThis.document = { visibilityState: "visible" };
  globalThis.location = { origin: "https://helm.test" };
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const { connectEvents, setToken } = await import("../src/client/api.ts");
    await setToken("resume-token");
    const pushed = [];
    let opens = 0;
    let closes = 0;
    const connection = connectEvents((message) => pushed.push(message), {
      onOpen: () => { opens += 1; },
      onClose: () => { closes += 1; },
    });
    assert.equal(FakeWebSocket.instances.length, 1);
    const originalSocket = FakeWebSocket.instances[0];
    assert.match(originalSocket.url, /^wss:\/\/helm\.test\/ws\?token=resume-token$/);
    originalSocket.open();
    originalSocket.receive({ type: "hello" });
    originalSocket.receive({ type: "pong" });
    originalSocket.receive({ type: "channel_update", channel: { id: 7 } });
    assert.deepEqual(pushed, [{ type: "channel_update", channel: { id: 7 } }], "transport frames never leak into app events");

    now += 60_000;
    connection.resume();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(originalSocket.closeCode, 4000);
    assert.equal(closes, 1);
    assert.equal(FakeWebSocket.instances.length, 2, "foreground recovery does not trust stale readyState=OPEN");
    FakeWebSocket.instances[1].open();
    assert.equal(opens, 2);

    connection.dispose();
    assert.equal(FakeWebSocket.instances[1].closeCode, 1000);
  } finally {
    Date.now = realNow;
    globalThis.WebSocket = original.WebSocket;
    globalThis.document = original.document;
    globalThis.location = original.location;
    globalThis.localStorage = original.localStorage;
  }
});

test("foreground resync refreshes the exact open thread and all status state", async () => {
  const { S, resyncVisibleState } = await import("../src/client/state.ts");
  const oldRoot = { id: 41 };
  Object.assign(S, { channelId: 7, view: "chat", channels: [{ id: 7 }], threadRoot: oldRoot, messages: [], channelBots: [] });
  const root = { id: 41, body: "fresh root" };
  const reply = { id: 42, body: "fresh reply" };
  const paths = [];
  let paints = 0;
  const request = async (path) => {
    paths.push(path);
    if (path.includes("/channels/")) return { messages: [root], bots: [{ id: 9 }] };
    return {
      root, replies: [reply], followup: { id: 3 }, followup_activity: [{ id: 5 }], stop_requested: true,
      usage: { input_tokens: 1200, output_tokens: 75, cached_input_tokens: 800, model_calls: 2 },
    };
  };
  await resyncVisibleState(request, async () => { S.channels = [{ id: 7 }]; }, () => { paints += 1; });
  assert.deepEqual(paths, ["/api/channels/7/messages?progress=summary", "/api/messages/41/thread?progress=summary"]);
  assert.equal(S.threadRoot, root);
  assert.deepEqual(S.threadReplies, [reply]);
  assert.deepEqual(S.threadFollowup, { id: 3 });
  assert.deepEqual(S.threadFollowupActivity, [{ id: 5 }]);
  assert.equal(S.threadStopContinuation, true);
  assert.deepEqual(S.threadUsage, { input_tokens: 1200, output_tokens: 75, cached_input_tokens: 800, model_calls: 2 });
  assert.equal(paints, 1);
});
