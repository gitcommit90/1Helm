import { api } from "./api.ts";
import { beep, type NotificationSound } from "./dom.ts";
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
  if (!isNativeMobile() || mobilePlatform() !== "ios") return { available: false, permission: "unavailable", registered: false, platforms: [], error: "" };
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
  if (!isNativeMobile() || mobilePlatform() !== "ios") return nativeNotificationState();
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
  if (!isNativeMobile() || mobilePlatform() !== "ios") return nativeNotificationState();
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
  if (!isNativeMobile() || mobilePlatform() !== "ios" || !nativeNotificationsEnabled()) return;
  await installNativeListeners();
  const PushNotifications = await pushNotifications();
  const permission = await PushNotifications.checkPermissions();
  nativePermission = permission.receive;
  if (permission.receive === "granted") {
    try { await registerNativeDevice(); }
    catch (error) { nativeRegistrationError = error instanceof Error ? error.message : String(error); }
  }
}
