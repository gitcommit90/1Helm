import { createHash } from "node:crypto";
import { q, q1, run, now, type Row } from "./db.ts";
import { installationManagementSecret } from "./collaboration.ts";
import { installedAppVersion } from "./updates.ts";

const RELAY = String(process.env.HELM_PUSH_RELAY_URL || "https://provision.1helm.com/v1/push").replace(/\/+$/, "");
const APP_ROOT = String(process.env.HELM_APP_ROOT || process.cwd());
let drainTimer: NodeJS.Timeout | null = null;
let draining = false;

type Platform = "ios" | "android";
type PushPayload = {
  title: string;
  body: string;
  channelId: number;
  messageId: number;
  rootMessageId: number | null;
  sound: boolean;
};

const workspaceIdentity = (): { installationId: string; secret: string } => {
  const installationId = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
  if (!/^[a-f0-9]{16}$/.test(installationId)) throw new Error("The 1Helm installation identity is unavailable.");
  return { installationId, secret: installationManagementSecret() };
};

const relayRecipientId = (secret: string, userId: number): string => createHash("sha256").update(`mobile-push:${secret}:${userId}`).digest("hex").slice(0, 32);

async function relay(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${RELAY}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || `Push relay returned HTTP ${response.status}.`));
  return payload;
}

async function ensureRelayInstallation(): Promise<{ installationId: string; secret: string }> {
  const identity = workspaceIdentity();
  await relay("/installations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installation_id: identity.installationId, management_secret: identity.secret }),
  });
  return identity;
}

export async function registerMobilePush(userId: number, platformInput: unknown, tokenInput: unknown): Promise<Row> {
  const platform = String(platformInput || "") as Platform;
  const token = String(tokenInput || "").trim();
  if (!(["ios", "android"] as string[]).includes(platform)) throw new Error("Unsupported mobile notification platform.");
  if (!/^[A-Za-z0-9:_-]{32,4096}$/.test(token)) throw new Error("The mobile notification token is invalid.");
  const identity = await ensureRelayInstallation();
  await relay("/devices", {
    method: "POST",
    headers: { authorization: `Bearer ${identity.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ installation_id: identity.installationId, recipient_id: relayRecipientId(identity.secret, userId), platform, token }),
  });
  const timestamp = now();
  run(`INSERT INTO mobile_push_registrations (user_id,platform,token,created,updated) VALUES (?,?,?,?,?)
    ON CONFLICT(platform,token) DO UPDATE SET user_id=excluded.user_id,updated=excluded.updated`, userId, platform, token, timestamp, timestamp);
  return q1("SELECT platform,created,updated FROM mobile_push_registrations WHERE platform=? AND token=?", platform, token)!;
}

export async function unregisterMobilePush(userId: number, platformInput?: unknown, tokenInput?: unknown): Promise<void> {
  const platform = String(platformInput || "");
  const token = String(tokenInput || "").trim();
  if (platform && !(["ios", "android"] as string[]).includes(platform)) throw new Error("Unsupported mobile notification platform.");
  if (token && !/^[A-Za-z0-9:_-]{32,4096}$/.test(token)) throw new Error("The mobile notification token is invalid.");
  const rows = platform && token
    ? q("SELECT platform,token FROM mobile_push_registrations WHERE user_id=? AND platform=? AND token=?", userId, platform, token)
    : platform
      ? q("SELECT platform,token FROM mobile_push_registrations WHERE user_id=? AND platform=?", userId, platform)
      : q("SELECT platform,token FROM mobile_push_registrations WHERE user_id=?", userId);
  if (!rows.length) return;
  const identity = await ensureRelayInstallation().catch(() => null);
  if (identity) await Promise.allSettled(rows.map((row) => relay("/devices", {
    method: "DELETE",
    headers: { authorization: `Bearer ${identity.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ installation_id: identity.installationId, recipient_id: relayRecipientId(identity.secret, userId), platform: row.platform, token: row.token }),
  })));
  if (platform && token) run("DELETE FROM mobile_push_registrations WHERE user_id=? AND platform=? AND token=?", userId, platform, token);
  else if (platform) run("DELETE FROM mobile_push_registrations WHERE user_id=? AND platform=?", userId, platform);
  else run("DELETE FROM mobile_push_registrations WHERE user_id=?", userId);
}

export function mobilePushStatus(userId: number, platformInput?: unknown, tokenInput?: unknown): { registered: boolean; platforms: string[] } {
  const platform = String(platformInput || "");
  const token = String(tokenInput || "").trim();
  if (platform && !(["ios", "android"] as string[]).includes(platform)) return { registered: false, platforms: [] };
  if (token && !/^[A-Za-z0-9:_-]{32,4096}$/.test(token)) return { registered: false, platforms: [] };
  const rows = platform && token
    ? q("SELECT platform FROM mobile_push_registrations WHERE user_id=? AND platform=? AND token=?", userId, platform, token)
    : q("SELECT DISTINCT platform FROM mobile_push_registrations WHERE user_id=? ORDER BY platform", userId);
  const platforms = [...new Set(rows.map((row) => String(row.platform)))];
  return { registered: platforms.length > 0, platforms };
}

function messageSettled(message: Row): boolean {
  const author = message.author && typeof message.author === "object" ? message.author as Row : {};
  if (author.kind === "user" || author.kind === "system") return true;
  const body = String(message.body || "").trim();
  if (!body || body === "_Working…_") return false;
  return !(Array.isArray(message.progress) && message.progress.some((item: Row) => item.status === "running"));
}

function notificationPreferences(userId: number, channelId: number): { muted: boolean; sound: boolean } {
  const row = q1("SELECT value FROM user_ui_state WHERE user_id=? AND key='notification_preferences'", userId);
  if (!row) return { muted: false, sound: true };
  try {
    const preferences = JSON.parse(String(row.value || "{}")) as { globalMuted?: unknown; channels?: Record<string, { muted?: unknown }> };
    return {
      muted: preferences.channels?.[String(channelId)]?.muted === true,
      sound: preferences.globalMuted !== true,
    };
  } catch { return { muted: false, sound: true }; }
}

function notificationBody(message: Row): string {
  const text = String(message.body || "").replace(/\s+/g, " ").trim();
  if (text) return text.length > 220 ? `${text.slice(0, 217)}…` : text;
  const attachments = Array.isArray(message.attachments) ? message.attachments.length : 0;
  return attachments ? `Shared ${attachments === 1 ? "an attachment" : `${attachments} attachments`}.` : "New activity";
}

/** Queue exactly one durable notification per recipient and settled message. */
export function queueMobilePush(channelId: number, event: unknown): void {
  const payload = event && typeof event === "object" ? event as { type?: unknown; message?: Row } : {};
  if (!["message", "message_update"].includes(String(payload.type || "")) || !payload.message || !messageSettled(payload.message)) return;
  const message = payload.message;
  const author = message.author && typeof message.author === "object" ? message.author as Row : {};
  const messageId = Number(message.id || 0);
  if (!messageId) return;
  const authorUserId = author.kind === "user" ? Number(author.id || 0) : 0;
  const channel = q1("SELECT name,kind FROM channels WHERE id=?", channelId);
  if (!channel) return;
  const title = channel.kind === "dm" ? String(author.name || "1Helm") : `#${String(channel.name || "channel")} · ${String(author.name || "1Helm")}`;
  const timestamp = now();
  for (const member of q(`SELECT DISTINCT m.user_id FROM members m
    JOIN mobile_push_registrations r ON r.user_id=m.user_id WHERE m.channel_id=?`, channelId)) {
    const userId = Number(member.user_id);
    if (!userId || userId === authorUserId) continue;
    const preference = notificationPreferences(userId, channelId);
    if (preference.muted) continue;
    const item: PushPayload = {
      title,
      body: notificationBody(message),
      channelId,
      messageId,
      rootMessageId: message.parent_id == null ? null : Number(message.parent_id),
      sound: preference.sound,
    };
    run(`INSERT OR IGNORE INTO mobile_push_outbox
      (user_id,channel_id,message_id,payload,state,next_attempt,created,updated) VALUES (?,?,?,?,'pending',0,?,?)`,
    userId, channelId, messageId, JSON.stringify(item), timestamp, timestamp);
  }
}

export async function drainMobilePush(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const identity = q1("SELECT 1 FROM mobile_push_registrations LIMIT 1") ? await ensureRelayInstallation() : null;
    if (!identity) return;
    for (const row of q("SELECT * FROM mobile_push_outbox WHERE state IN ('pending','failed') AND next_attempt<=? AND attempt_count<20 ORDER BY id LIMIT 50", now())) {
      const claimed = run("UPDATE mobile_push_outbox SET state='sending',attempt_count=attempt_count+1,updated=? WHERE id=? AND state IN ('pending','failed')", now(), row.id);
      if (!claimed.changes) continue;
      try {
        await relay("/deliveries", {
          method: "POST",
          headers: { authorization: `Bearer ${identity.secret}`, "content-type": "application/json" },
          body: JSON.stringify({
            installation_id: identity.installationId,
            recipient_id: relayRecipientId(identity.secret, Number(row.user_id)),
            idempotency_key: `${identity.installationId}:${Number(row.user_id)}:${Number(row.message_id)}`,
            app_version: installedAppVersion(APP_ROOT),
            ...JSON.parse(String(row.payload || "{}")),
          }),
        });
        run("UPDATE mobile_push_outbox SET state='delivered',last_error='',updated=? WHERE id=?", now(), row.id);
      } catch (error) {
        const attempts = Number(row.attempt_count || 0) + 1;
        const delay = Math.min(60 * 60_000, Math.max(15_000, 2 ** Math.min(attempts, 8) * 1000));
        run("UPDATE mobile_push_outbox SET state='failed',next_attempt=?,last_error=?,updated=? WHERE id=?", now() + delay, String((error as Error).message).slice(0, 500), now(), row.id);
      }
    }
  } catch { /* relay setup remains retryable without interrupting chat */ }
  finally { draining = false; }
}

export function startMobilePushLoop(): void {
  if (drainTimer) return;
  void drainMobilePush();
  drainTimer = setInterval(() => { void drainMobilePush(); }, 30_000);
  drainTimer.unref();
}
