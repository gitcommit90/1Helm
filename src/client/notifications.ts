import { api } from "./api.ts";
import { beep, h, type NotificationSound } from "./dom.ts";
import { getServerOrigin, isNativeMobile, mobilePlatform } from "./mobile.ts";
import type { PermissionStatus } from "@capacitor/push-notifications";

let pushNotificationsPromise: Promise<typeof import("@capacitor/push-notifications")["PushNotifications"]> | null = null;
function pushNotifications(): Promise<typeof import("@capacitor/push-notifications")["PushNotifications"]> {
  return pushNotificationsPromise ||= import("@capacitor/push-notifications").then((module) => module.PushNotifications);
}

export const NOTIFICATION_SOUNDS: ReadonlyArray<{ value: NotificationSound; label: string }> = [
  { value: "helm", label: "Helm chirp" },
  { value: "bell", label: "Ship bell" },
  { value: "chime", label: "Glass chime" },
  { value: "pulse", label: "Soft pulse" },
];

type ChannelNotificationPreference = { muted: boolean; sound: NotificationSound };
type NotificationPreferences = {
  globalMuted: boolean;
  channels: Record<number, ChannelNotificationPreference>;
};

const sounds = new Set<NotificationSound>(NOTIFICATION_SOUNDS.map((item) => item.value));
let preferences: NotificationPreferences = { globalMuted: false, channels: {} };
let nativePermission: PermissionStatus["receive"] | "unavailable" = isNativeMobile() ? "prompt" : "unavailable";
let nativeRegistrationError = "";
let nativeListenersReady = false;
let nativeNavigationHandler: ((channelId: number, rootMessageId: number | null) => void) | null = null;
let nativeRegistrationAttempt: { resolve: () => void; reject: (error: Error) => void } | null = null;
let nativeRegistrationPromise: Promise<void> | null = null;
let nativeDeviceToken = "";

const nativePreferenceKey = (): string => `1helm.mobile.push.enabled:${getServerOrigin()}`;
const nativeNotificationsEnabled = (): boolean => localStorage.getItem(nativePreferenceKey()) === "1";

function soundValue(value: unknown): NotificationSound {
  return sounds.has(value as NotificationSound) ? value as NotificationSound : "helm";
}

/** Hydrate the signed-in user's server-owned notification state. */
export function hydrateNotificationPreferences(value: unknown): void {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawChannels = raw.channels && typeof raw.channels === "object" ? raw.channels as Record<string, unknown> : {};
  const channels: Record<number, ChannelNotificationPreference> = {};
  for (const [key, item] of Object.entries(rawChannels)) {
    const channelId = Number(key);
    if (!Number.isSafeInteger(channelId) || channelId <= 0 || !item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    channels[channelId] = { muted: row.muted === true, sound: soundValue(row.sound) };
  }
  preferences = { globalMuted: raw.globalMuted === true, channels };
}

export function globalNotificationsMuted(): boolean {
  return preferences.globalMuted;
}

export function channelNotificationPreference(channelId: number): ChannelNotificationPreference {
  return preferences.channels[channelId] || { muted: false, sound: "helm" };
}

async function persist(next: NotificationPreferences): Promise<void> {
  const result = await api<{ state: Record<string, unknown> }>("/api/me/ui-state", {
    method: "PATCH",
    body: { key: "notification_preferences", value: next },
  });
  hydrateNotificationPreferences(result.state.notification_preferences);
}

export async function setGlobalNotificationsMuted(muted: boolean): Promise<void> {
  await persist({ ...preferences, globalMuted: muted });
}

export async function setChannelNotificationPreference(
  channelId: number,
  patch: Partial<ChannelNotificationPreference>,
): Promise<void> {
  const current = channelNotificationPreference(channelId);
  await persist({
    ...preferences,
    channels: {
      ...preferences.channels,
      [channelId]: { muted: patch.muted ?? current.muted, sound: soundValue(patch.sound ?? current.sound) },
    },
  });
}

export function playNotification(channelId: number, kind: "msg" | "mention" = "msg"): void {
  const channel = channelNotificationPreference(channelId);
  if (preferences.globalMuted || channel.muted) return;
  beep(kind, channel.sound);
}

export function previewNotification(sound: NotificationSound): void {
  beep("msg", soundValue(sound));
}

function pushTarget(data: unknown): { channelId: number; rootMessageId: number | null } | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const channelId = Number(row.channelId || row.channel_id || 0);
  const rootMessageId = Number(row.rootMessageId || row.root_message_id || 0) || null;
  return Number.isSafeInteger(channelId) && channelId > 0 ? { channelId, rootMessageId } : null;
}

export function setNativeNotificationNavigation(handler: (channelId: number, rootMessageId: number | null) => void): void {
  nativeNavigationHandler = handler;
}

async function installNativeListeners(): Promise<void> {
  if (!isNativeMobile() || nativeListenersReady) return;
  nativeListenersReady = true;
  const PushNotifications = await pushNotifications();
  await PushNotifications.addListener("registration", ({ value }) => {
    nativeDeviceToken = value;
    nativeRegistrationError = "";
    void api("/api/mobile/push", { body: { platform: mobilePlatform(), token: value } }).then(() => {
      nativeRegistrationAttempt?.resolve();
    }).catch((error) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      nativeRegistrationError = failure.message;
      nativeRegistrationAttempt?.reject(failure);
    });
  });
  await PushNotifications.addListener("registrationError", ({ error }) => {
    nativeRegistrationError = String(error || "Registration failed.");
    nativeRegistrationAttempt?.reject(new Error(nativeRegistrationError));
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const target = pushTarget(notification.data);
    if (target) nativeNavigationHandler?.(target.channelId, target.rootMessageId);
  });
}

async function registerNativeDevice(): Promise<void> {
  if (nativeRegistrationPromise) return nativeRegistrationPromise;
  nativeRegistrationPromise = (async () => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const completion = new Promise<void>((resolve, reject) => {
      nativeRegistrationAttempt = { resolve, reject };
      timer = setTimeout(() => reject(new Error("Notification registration timed out. Please try again.")), 20_000);
    });
    try {
      const PushNotifications = await pushNotifications();
      await PushNotifications.register();
      await completion;
    } finally {
      if (timer) clearTimeout(timer);
      nativeRegistrationAttempt = null;
    }
  })();
  try { await nativeRegistrationPromise; }
  finally { nativeRegistrationPromise = null; }
}

export type NativeNotificationState = {
  available: boolean;
  permission: PermissionStatus["receive"] | "unavailable";
  registered: boolean;
  platforms: string[];
  error: string;
};

export async function nativeNotificationState(): Promise<NativeNotificationState> {
  if (!isNativeMobile() || !["ios", "android"].includes(mobilePlatform())) return { available: false, permission: "unavailable", registered: false, platforms: [], error: "" };
  await installNativeListeners();
  const PushNotifications = await pushNotifications();
  nativePermission = (await PushNotifications.checkPermissions()).receive;
  if (!nativeNotificationsEnabled() || nativePermission !== "granted") return { available: true, permission: nativePermission, registered: false, platforms: [], error: nativeRegistrationError };
  if (!nativeDeviceToken) {
    try { await registerNativeDevice(); }
    catch (error) { nativeRegistrationError = error instanceof Error ? error.message : String(error); }
  }
  if (!nativeDeviceToken) return { available: true, permission: nativePermission, registered: false, platforms: [], error: nativeRegistrationError };
  const server = await api<{ registered: boolean; platforms: string[] }>("/api/mobile/push/status", {
    body: { platform: mobilePlatform(), token: nativeDeviceToken },
  }).catch(() => ({ registered: false, platforms: [] }));
  return { available: true, permission: nativePermission, registered: server.registered, platforms: server.platforms || [], error: nativeRegistrationError };
}

/** Request OS permission only from an explicit user action, then bind this device to the signed-in 1Helm profile. */
export async function enableNativeNotifications(): Promise<NativeNotificationState> {
  if (!isNativeMobile() || !["ios", "android"].includes(mobilePlatform())) return nativeNotificationState();
  await installNativeListeners();
  const PushNotifications = await pushNotifications();
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") permission = await PushNotifications.requestPermissions();
  nativePermission = permission.receive;
  if (permission.receive !== "granted") return nativeNotificationState();
  nativeRegistrationError = "";
  try { await registerNativeDevice(); }
  catch (error) { nativeRegistrationError = error instanceof Error ? error.message : String(error); }
  if (nativeDeviceToken && !nativeRegistrationError) localStorage.setItem(nativePreferenceKey(), "1");
  return nativeNotificationState();
}

export async function disableNativeNotifications(): Promise<NativeNotificationState> {
  if (!isNativeMobile() || !["ios", "android"].includes(mobilePlatform())) return nativeNotificationState();
  const PushNotifications = await pushNotifications();
  if (!nativeDeviceToken && nativeNotificationsEnabled() && nativePermission === "granted") await registerNativeDevice().catch(() => undefined);
  if (nativeDeviceToken) await api("/api/mobile/push", { method: "DELETE", body: { platform: mobilePlatform(), token: nativeDeviceToken } }).catch(() => undefined);
  await PushNotifications.unregister().catch(() => undefined);
  nativeDeviceToken = "";
  localStorage.removeItem(nativePreferenceKey());
  return nativeNotificationState();
}

/** Re-register an already-authorized app after sign-in without prompting. */
export async function restoreNativeNotifications(): Promise<void> {
  if (!isNativeMobile() || !["ios", "android"].includes(mobilePlatform()) || !nativeNotificationsEnabled()) return;
  await installNativeListeners();
  const PushNotifications = await pushNotifications();
  const permission = await PushNotifications.checkPermissions();
  nativePermission = permission.receive;
  if (permission.receive === "granted") {
    try { await registerNativeDevice(); }
    catch (error) { nativeRegistrationError = error instanceof Error ? error.message : String(error); }
  }
}

export type BrowserNotificationState = {
  available: boolean;
  permission: NotificationPermission | "unavailable";
  registered: boolean;
  backgroundCapable: boolean;
  error: string;
};

let browserNotificationError = "";
let browserPushRegistered = false;
const browserPreferenceKey = (): string => `1helm.browser.notifications.enabled:${getServerOrigin()}`;
const browserNotificationsEnabled = (): boolean => localStorage.getItem(browserPreferenceKey()) === "1";
const isElectronClient = (): boolean => /\bElectron\//.test(navigator.userAgent);
const browserNotificationAvailable = (): boolean => !isNativeMobile() && typeof Notification !== "undefined";
const backgroundWebPushAvailable = (): boolean => browserNotificationAvailable() && location.protocol === "https:" && "serviceWorker" in navigator && "PushManager" in window;

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const bytes = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const result = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index++) result[index] = bytes.charCodeAt(index);
  return result;
}

async function currentBrowserSubscription(): Promise<PushSubscription | null> {
  if (!backgroundWebPushAvailable()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function browserNotificationState(): Promise<BrowserNotificationState> {
  if (!browserNotificationAvailable()) return { available: false, permission: "unavailable", registered: false, backgroundCapable: false, error: "" };
  const permission = Notification.permission;
  if (!backgroundWebPushAvailable()) return { available: true, permission, registered: permission === "granted" && browserNotificationsEnabled(), backgroundCapable: false, error: browserNotificationError };
  try {
    const subscription = await currentBrowserSubscription();
    if (!subscription) { browserPushRegistered = false; return { available: true, permission, registered: false, backgroundCapable: true, error: browserNotificationError }; }
    const status = await api<{ registered: boolean }>("/api/web-push/status", { body: { endpoint: subscription.endpoint } });
    browserPushRegistered = status.registered;
    return { available: true, permission, registered: status.registered, backgroundCapable: true, error: browserNotificationError };
  } catch (error) {
    browserNotificationError = error instanceof Error ? error.message : String(error);
    return { available: true, permission, registered: false, backgroundCapable: true, error: browserNotificationError };
  }
}

/** Request browser/desktop permission from an explicit click and retain a server-side Web Push subscription when supported. */
export async function enableBrowserNotifications(): Promise<BrowserNotificationState> {
  if (!browserNotificationAvailable()) return browserNotificationState();
  browserNotificationError = "";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return browserNotificationState();
  localStorage.setItem(browserPreferenceKey(), "1");
  if (!backgroundWebPushAvailable()) return browserNotificationState();
  try {
    const registration = await navigator.serviceWorker.ready;
    const key = await api<{ publicKey: string }>("/api/web-push/key");
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(key.publicKey) });
    await api("/api/web-push", { body: { subscription: subscription.toJSON() } });
    browserPushRegistered = true;
  } catch (error) { browserNotificationError = error instanceof Error ? error.message : String(error); }
  return browserNotificationState();
}

export async function disableBrowserNotifications(): Promise<BrowserNotificationState> {
  if (!browserNotificationAvailable()) return browserNotificationState();
  browserNotificationError = "";
  if (backgroundWebPushAvailable()) {
    try {
      const subscription = await currentBrowserSubscription();
      if (subscription) {
        await api("/api/web-push", { method: "DELETE", body: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
    } catch (error) { browserNotificationError = error instanceof Error ? error.message : String(error); }
  }
  browserPushRegistered = false;
  localStorage.removeItem(browserPreferenceKey());
  return browserNotificationState();
}

const liveSystemNotificationsShown = new Set<number>();
export function showLiveSystemNotification(message: { id: number; channel_id: number; parent_id: number | null; body: string; author?: { name?: string } }, channelName = ""): void {
  if (!browserNotificationAvailable() || Notification.permission !== "granted" || !browserNotificationsEnabled() || document.visibilityState === "visible" || document.hasFocus()) return;
  // Browsers with a retained Push API subscription receive the durable server push;
  // Electron and legacy browsers use this renderer-backed native notification.
  if (browserPushRegistered && !isElectronClient()) return;
  if (liveSystemNotificationsShown.has(message.id)) return;
  liveSystemNotificationsShown.add(message.id);
  if (liveSystemNotificationsShown.size > 500) liveSystemNotificationsShown.delete(liveSystemNotificationsShown.values().next().value!);
  const title = channelName ? `#${channelName} · ${message.author?.name || "1Helm"}` : message.author?.name || "1Helm";
  const body = String(message.body || "New activity").replace(/\s+/g, " ").trim().slice(0, 220) || "New activity";
  const notification = new Notification(title, { body, icon: "/icons/icon-sailboat-192.png", tag: `1helm-message-${message.id}` });
  notification.onclick = () => {
    window.focus();
    nativeNavigationHandler?.(message.channel_id, message.parent_id);
    notification.close();
  };
}

export function notificationDeviceCards(): HTMLElement[] {
  const nativeCard = h("section", { class: "card space-y-3 p-4", dataset: { nativeNotifications: "" } },
    h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Phone notifications"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Receive channel and resident-agent updates when 1Helm is closed or in the background.")),
    h("p", { class: "text-sm text-muted" }, "Checking this device…"));
  const drawNative = async (): Promise<void> => {
    const state = await nativeNotificationState();
    if (!state.available) { nativeCard.remove(); return; }
    const enabled = state.permission === "granted" && state.registered;
    const action = h("button", { class: enabled ? "btn-subtle text-sm" : "btn-primary text-sm", type: "button" }, enabled ? "Turn off on this phone" : state.permission === "denied" ? "Check again" : "Turn on notifications") as HTMLButtonElement;
    const blocked = mobilePlatform() === "android" ? "Notifications are blocked in Android Settings. Open Apps → 1Helm → Notifications to allow them." : "Notifications are blocked in iOS Settings. Open Settings → Notifications → 1Helm to allow them.";
    const detail = h("p", { class: `text-sm ${state.error ? "text-danger" : "text-muted"}` }, state.error || (enabled ? "This phone is registered for 1Helm notifications." : state.permission === "denied" ? blocked : "1Helm will ask for permission once, after you choose Turn on."));
    action.onclick = async () => { action.disabled = true; if (enabled) await disableNativeNotifications(); else if (state.permission !== "denied") await enableNativeNotifications(); await drawNative(); };
    nativeCard.replaceChildren(h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Phone notifications"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Receive channel and resident-agent updates when 1Helm is closed or in the background.")), h("div", { class: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" }, detail, action));
  };
  void drawNative();

  const browserCard = h("section", { class: "card space-y-3 p-4", dataset: { browserNotifications: "" } },
    h("div", {}, h("h3", { class: "font-semibold text-fg" }, "System notifications"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Receive native desktop or browser notifications when 1Helm is not in front.")),
    h("p", { class: "text-sm text-muted" }, "Checking this browser…"));
  const drawBrowser = async (): Promise<void> => {
    if (isNativeMobile()) { browserCard.remove(); return; }
    const state = await browserNotificationState();
    if (!state.available) { browserCard.remove(); return; }
    const enabled = state.permission === "granted" && state.registered;
    const action = h("button", { class: enabled ? "btn-subtle text-sm" : "btn-primary text-sm", type: "button" }, enabled ? "Turn off on this device" : state.permission === "denied" ? "Blocked by browser" : "Turn on notifications") as HTMLButtonElement;
    const detailText = state.error || (enabled ? state.backgroundCapable ? "This browser is registered for notifications, including while the page is closed." : "This desktop app will notify while 1Helm is running." : state.permission === "denied" ? "Notifications are blocked in this browser or operating-system settings." : "1Helm will ask once after you choose Turn on.");
    const detail = h("p", { class: `text-sm ${state.error ? "text-danger" : "text-muted"}` }, detailText);
    action.onclick = async () => { action.disabled = true; if (enabled) await disableBrowserNotifications(); else if (state.permission !== "denied") await enableBrowserNotifications(); await drawBrowser(); };
    browserCard.replaceChildren(h("div", {}, h("h3", { class: "font-semibold text-fg" }, "System notifications"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Receive native desktop or browser notifications when 1Helm is not in front.")), h("div", { class: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" }, detail, action));
  };
  void drawBrowser();
  return [nativeCard, browserCard];
}
