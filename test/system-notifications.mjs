import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const requests = [];
let subscribed = null;
const subscription = {
  endpoint: "https://push.example.test/device/browser",
  toJSON: () => ({ endpoint: "https://push.example.test/device/browser", keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } }),
  unsubscribe: async () => { subscribed = null; return true; },
};
const pushManager = {
  getSubscription: async () => subscribed,
  subscribe: async ({ userVisibleOnly, applicationServerKey }) => {
    assert.equal(userVisibleOnly, true);
    assert.ok(applicationServerKey instanceof Uint8Array);
    subscribed = subscription;
    return subscription;
  },
};
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
globalThis.location = { protocol: "https:" };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Mozilla/5.0", serviceWorker: { ready: Promise.resolve({ pushManager }) } } });
globalThis.document = { visibilityState: "hidden", hasFocus: () => false };
globalThis.window = { AudioContext: class {}, PushManager: class {} };
class FakeNotification {
  static permission = "default";
  static shown = [];
  static async requestPermission() { this.permission = "granted"; return "granted"; }
  constructor(title, options) { this.title = title; this.options = options; FakeNotification.shown.push(this); }
  close() {}
}
globalThis.Notification = FakeNotification;
globalThis.fetch = async (path, init = {}) => {
  requests.push({ path, init });
  if (path === "/api/web-push/key") return Response.json({ publicKey: "BCo9mKZ2XL7Xv9V4BpxpF4kO8H-Uv4x2UcvnM0O7EQGIeb2A_zZC_h7I4cL2H8kY3Rz8n6cMBfk0kIrGgHczsVE" });
  if (path === "/api/web-push/status") return Response.json({ registered: Boolean(subscribed) });
  return Response.json({ registered: true, ok: true });
};

const notifications = await import("../src/client/notifications.ts");

test("web notification opt-in requests permission, creates Push API subscription, and persists it", async () => {
  const state = await notifications.enableBrowserNotifications();
  assert.equal(state.permission, "granted");
  assert.equal(state.registered, true);
  assert.equal(state.backgroundCapable, true);
  assert.ok(requests.some((request) => request.path === "/api/web-push" && JSON.parse(request.init.body).subscription.endpoint === subscription.endpoint));
});

test("durable web push suppresses renderer duplicates while Electron receives a native notification", () => {
  notifications.showLiveSystemNotification({ id: 41, channel_id: 3, parent_id: null, body: "Done", author: { name: "Agent" } }, "build");
  assert.equal(FakeNotification.shown.length, 0, "a subscribed browser relies on its service worker delivery");
  navigator.userAgent = "1Helm Electron/43.1.1";
  notifications.showLiveSystemNotification({ id: 42, channel_id: 3, parent_id: null, body: "Done", author: { name: "Agent" } }, "build");
  assert.equal(FakeNotification.shown.length, 1);
  assert.equal(FakeNotification.shown[0].title, "#build · Agent");
});

test("service worker owns background display, foreground suppression, and click navigation", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("push"/);
  assert.match(source, /visibilityState === "visible"/);
  assert.match(source, /showNotification/);
  assert.match(source, /addEventListener\("notificationclick"/);
  assert.match(source, /clients\.openWindow/);
});


test("notification click focuses the WindowClient returned by navigation", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  let originalFocused = 0;
  let navigatedFocused = 0;
  const navigated = { focus: async () => { navigatedFocused += 1; return navigated; } };
  const original = { url: "https://helm.example/c/old/chat", visibilityState: "hidden", navigate: async () => navigated, focus: async () => { originalFocused += 1; return original; } };
  const self = {
    location: { origin: "https://helm.example" },
    clients: { matchAll: async () => [original], openWindow: async () => null, claim: async () => undefined },
    registration: { showNotification: async () => undefined },
    addEventListener: (name, handler) => listeners.set(name, handler),
    skipWaiting: async () => undefined,
  };
  vm.runInNewContext(source, { self, URL, caches: { keys: async () => [], open: async () => ({ addAll: async () => undefined }), delete: async () => true }, fetch: async () => new Response(), Response });
  let completed;
  listeners.get("notificationclick")({
    notification: { close() {}, data: { url: "/c/build/thread/9" } },
    waitUntil: (promise) => { completed = promise; },
  });
  await completed;
  assert.equal(navigatedFocused, 1, "focus follows the navigated client returned by the browser");
  assert.equal(originalFocused, 0, "the stale pre-navigation WindowClient is not focused");
});
