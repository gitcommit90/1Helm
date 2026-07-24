import { api } from "./api.ts";
import { beep, type NotificationSound } from "./dom.ts";

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
