import type { WebSocket } from "ws";
import { getComputer, createTerminal, connectTerminal, deleteTerminal } from "./computer.ts";
import {
  attachChannelTerminal,
  closeChannelComputerTerminals,
  closeChannelTerminal,
  hasChannelComputerTerminal,
  listChannelTerminals,
  openChannelTerminal,
} from "./channel-computers.ts";

/**
 * Server-side terminal session manager. Each session owns one upstream PTY and
 * fans out only to the user who opened it. Channel ownership pins its CWD.
 */

type Session = {
  id: string;
  computerId: number;
  channelId: number;
  ownerId: number;
  cwd: string;
  upstreamId: string;
  upstream: WebSocket;
  clients: Set<WebSocket>;
  scrollback: Buffer[];
  bytes: number;
  cols: number;
  rows: number;
  ready: Promise<void>;
};

const SCROLLBACK_CAP = 256 * 1024;
const sessions = new Map<string, Session>();
const sid = (): string => "s" + Math.random().toString(36).slice(2, 12);

export async function openSession(computerId: number, channelId: number, ownerId: number, cwd: string, cols: number, rows: number): Promise<string> {
  const computer = getComputer(computerId);
  if (!computer) throw new Error("computer not found");
  // Empty cwd means let the remote Open Terminal instance pick its default shell root.
  const upstreamId = await createTerminal(computer, cols, rows, cwd || undefined);
  const upstream = connectTerminal(computer, upstreamId);
  const s: Session = { id: sid(), computerId, channelId, ownerId, cwd, upstreamId, upstream, clients: new Set(), scrollback: [], bytes: 0, cols, rows, ready: Promise.resolve() };
  s.ready = new Promise((resolve) => upstream.once("open", () => resolve()));

  upstream.on("message", (raw: Buffer) => {
    s.scrollback.push(raw);
    s.bytes += raw.length;
    while (s.bytes > SCROLLBACK_CAP && s.scrollback.length > 1) s.bytes -= s.scrollback.shift()!.length;
    for (const client of s.clients) if (client.readyState === client.OPEN) client.send(raw);
  });
  const stop = (): void => { for (const client of s.clients) try { client.close(); } catch { /* closed */ } sessions.delete(s.id); };
  upstream.on("close", stop);
  upstream.on("error", stop);

  const keepalive = setInterval(() => {
    if (!sessions.has(s.id)) { clearInterval(keepalive); return; }
    if (s.upstream.readyState === s.upstream.OPEN) s.upstream.ping();
  }, 25_000);

  sessions.set(s.id, s);
  return s.id;
}

export async function attachClient(sessionId: string, client: WebSocket, userId: number): Promise<void> {
  if (hasChannelComputerTerminal(sessionId)) { await attachChannelTerminal(sessionId, client, userId); return; }
  const s = sessions.get(sessionId);
  if (!s || s.ownerId !== userId) { client.close(4004, "Session not found"); return; }
  const pending: { raw: Buffer; isBinary: boolean }[] = [];
  const forward = (raw: Buffer, isBinary: boolean): void => {
    if (isBinary) { s.upstream.send(raw); return; }
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") { if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: "pong", at: Date.now() })); }
      else if (msg.type === "resize") { s.cols = msg.cols; s.rows = msg.rows; s.upstream.send(JSON.stringify(msg)); }
      else if (msg.type === "input") s.upstream.send(Buffer.from(String(msg.data), "utf8"));
    } catch { s.upstream.send(raw); }
  };
  client.on("message", (raw: Buffer, isBinary: boolean) => {
    if (s.upstream.readyState === s.upstream.OPEN) forward(raw, isBinary);
    else pending.push({ raw: Buffer.from(raw), isBinary });
  });
  client.on("close", () => s.clients.delete(client));
  await s.ready;
  if (client.readyState !== client.OPEN || !sessions.has(sessionId)) return;
  for (const chunk of s.scrollback) client.send(chunk);
  s.clients.add(client);
  for (const message of pending) forward(message.raw, message.isBinary);
}

export function listSessions(userId: number, channelId?: number): { id: string; computerId: number; channelId: number; clients: number }[] {
  return [...sessions.values()]
    .filter((session) => session.ownerId === userId && (channelId == null || session.channelId === channelId))
    .map((session) => ({ id: session.id, computerId: session.computerId, channelId: session.channelId, clients: session.clients.size }))
    .concat(listChannelTerminals(userId, channelId));
}

export function closeChannelSessions(channelId: number): void {
  for (const session of sessions.values()) if (session.channelId === channelId) closeSession(session.id);
  closeChannelComputerTerminals(channelId);
}

export function closeSession(sessionId: string): void {
  if (hasChannelComputerTerminal(sessionId)) { closeChannelTerminal(sessionId); return; }
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  try { s.upstream.close(); } catch { /* closed */ }
  const computer = getComputer(s.computerId);
  if (computer) void deleteTerminal(computer, s.upstreamId);
}

/** Ordinary channel Terminal: opens inside that channel's persistent Linux computer. */
export async function openChannelSession(channelId: number, _ownerId: number, cols: number, rows: number): Promise<string> {
  return openChannelTerminal(channelId, _ownerId, cols, rows);
}
