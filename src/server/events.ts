import type { WebSocket } from "ws";
import { q, q1 } from "./db.ts";

/** Live event fan-out to browser clients, scoped by channel membership. */
type Client = { ws: WebSocket; userId: number };
const clients = new Set<Client>();

export function register(ws: WebSocket, userId: number): Client {
  const c: Client = { ws, userId };
  clients.add(c);
  return c;
}
export const unregister = (c: Client): boolean => clients.delete(c);

/** Channel activity is always membership-scoped, including agent channels. */
function audience(channelId: number): Set<number> {
  return new Set(q("SELECT user_id FROM members WHERE channel_id=?", channelId).map((r) => Number(r.user_id)));
}

export function broadcastToChannel(channelId: number, payload: unknown): void {
  const aud = audience(channelId);
  const data = JSON.stringify(payload);
  for (const c of clients) {
    if (!aud.has(c.userId)) continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}

/** Send to specific users regardless of channel (e.g. system notices). */
export function sendToUsers(userIds: number[], payload: unknown): void {
  const set = new Set(userIds);
  const data = JSON.stringify(payload);
  for (const c of clients) if (set.has(c.userId) && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
}

/** Non-sensitive workspace fan-out such as public profiles and workspace name. */
export function broadcastAll(payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const c of clients) if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
}

/** Captain control-plane fan-out. Coworkers learn only about their channel
 * memberships and channel-scoped activity. */
export function broadcastAdmins(payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const c of clients) {
    if (!q1("SELECT 1 FROM users WHERE id=? AND is_admin=1", c.userId)) continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}

/** Distinct user ids currently connected over the app event socket. */
export function connectedUserIds(): number[] {
  const ids = new Set<number>();
  for (const c of clients) if (c.ws.readyState === c.ws.OPEN) ids.add(c.userId);
  return [...ids];
}
