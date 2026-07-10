import type { WebSocket } from "ws";
import { getComputer, createTerminal, connectTerminal } from "./computer.ts";

/**
 * Server-side terminal session manager. Each session owns ONE upstream WebSocket to
 * the computer's PTY and fans out to any number of browser clients. Because the server
 * keeps the upstream open (with pings) even when no browser is attached, sessions stay
 * alive across tab closes / reconnects — the requested keep-alive behavior.
 */

type Session = {
  id: string;
  computerId: number;
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
const sid = (): string => "s" + Math.random().toString(36).slice(2, 10);

export async function openSession(computerId: number, cols: number, rows: number): Promise<string> {
  const computer = getComputer(computerId);
  if (!computer) throw new Error("computer not found");
  const upstreamId = await createTerminal(computer, cols, rows);
  const upstream = connectTerminal(computer, upstreamId);
  const s: Session = { id: sid(), computerId, upstreamId, upstream, clients: new Set(), scrollback: [], bytes: 0, cols, rows, ready: Promise.resolve() };
  s.ready = new Promise((resolve) => upstream.once("open", () => resolve()));

  upstream.on("message", (raw: Buffer) => {
    s.scrollback.push(raw);
    s.bytes += raw.length;
    while (s.bytes > SCROLLBACK_CAP && s.scrollback.length > 1) s.bytes -= s.scrollback.shift()!.length;
    for (const c of s.clients) if (c.readyState === c.OPEN) c.send(raw);
  });
  const stop = (): void => { for (const c of s.clients) try { c.close(); } catch { /* closed */ } sessions.delete(s.id); };
  upstream.on("close", stop);
  upstream.on("error", stop);

  const ka = setInterval(() => {
    if (!sessions.has(s.id)) { clearInterval(ka); return; }
    if (s.upstream.readyState === s.upstream.OPEN) s.upstream.ping();
  }, 25_000);

  sessions.set(s.id, s);
  return s.id;
}

export async function attachClient(sessionId: string, client: WebSocket): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) { client.close(4004, "Session not found"); return; }
  await s.ready;
  for (const chunk of s.scrollback) if (client.readyState === client.OPEN) client.send(chunk);
  s.clients.add(client);
  client.on("message", (raw: Buffer, isBinary: boolean) => {
    if (s.upstream.readyState !== s.upstream.OPEN) return;
    if (isBinary) { s.upstream.send(raw); return; }
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "resize") { s.cols = msg.cols; s.rows = msg.rows; s.upstream.send(JSON.stringify(msg)); }
      else if (msg.type === "input") s.upstream.send(Buffer.from(String(msg.data), "utf8"));
    } catch { s.upstream.send(raw); }
  });
  client.on("close", () => s.clients.delete(client));
}

export function listSessions(): { id: string; computerId: number; clients: number }[] {
  return [...sessions.values()].map((s) => ({ id: s.id, computerId: s.computerId, clients: s.clients.size }));
}

export function closeSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { s.upstream.close(); } catch { /* closed */ }
  sessions.delete(sessionId);
}
