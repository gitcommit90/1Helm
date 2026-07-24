import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

let oscillators = 0;
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    oscillators++;
    return { type: "sine", frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
}
globalThis.window = { AudioContext: FakeAudioContext };

let serverPreference = { globalMuted: false, channels: {} };
const requests = [];
globalThis.fetch = async (path, init = {}) => {
  requests.push({ path, init });
  if (init.body) serverPreference = JSON.parse(String(init.body)).value;
  return Response.json({ state: { notification_preferences: serverPreference } });
};

const notifications = await import("../src/client/notifications.ts");

test("notification sounds honor user-global and per-channel mute before audio", () => {
  notifications.hydrateNotificationPreferences({ globalMuted: true, channels: { 7: { muted: false, sound: "chime" } } });
  notifications.playNotification(7);
  assert.equal(oscillators, 0);

  notifications.hydrateNotificationPreferences({ globalMuted: false, channels: { 7: { muted: true, sound: "chime" } } });
  notifications.playNotification(7);
  assert.equal(oscillators, 0);

  notifications.hydrateNotificationPreferences({ globalMuted: false, channels: { 7: { muted: false, sound: "chime" } } });
  notifications.playNotification(7);
  assert.equal(oscillators, 3, "the selected three-note channel chime is used");
});

test("global and channel notification choices use profile-bound server state", async () => {
  notifications.hydrateNotificationPreferences({ globalMuted: false, channels: {} });
  await notifications.setGlobalNotificationsMuted(true);
  assert.equal(notifications.globalNotificationsMuted(), true);
  await notifications.setChannelNotificationPreference(42, { muted: true, sound: "bell" });
  assert.deepEqual(notifications.channelNotificationPreference(42), { muted: true, sound: "bell" });
  assert.equal(requests.every((request) => request.path === "/api/me/ui-state"), true);
  assert.equal(requests.every((request) => JSON.parse(String(request.init.body)).key === "notification_preferences"), true);
});
