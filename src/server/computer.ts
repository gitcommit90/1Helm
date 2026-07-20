import { WebSocket } from "ws";
import { q1, type Row } from "./db.ts";

export type Computer = { id: number; name: string; base_url: string; api_key: string };

export const getComputer = (id: number): Computer | undefined => q1("SELECT * FROM computers WHERE id=?", id) as Computer | undefined;

const httpBase = (c: Computer): string => c.base_url.replace(/\/$/, "");
const authHeaders = (c: Computer): Record<string, string> =>
  c.api_key ? { authorization: `Bearer ${c.api_key}`, "content-type": "application/json" } : { "content-type": "application/json" };

/** Run a command on a computer and wait (bounded) for it to finish, returning combined output. */
export async function execOnComputer(c: Computer, command: string, cwd?: string, waitSec = 60, signal?: AbortSignal): Promise<{ status: string; exit_code: number | null; output: string }> {
  const res = await fetch(`${httpBase(c)}/execute?wait=${waitSec}`, {
    method: "POST", headers: authHeaders(c), body: JSON.stringify({ command, cwd }), signal,
  });
  if (!res.ok) throw new Error(`exec failed (${res.status}): ${await res.text()}`);
  let data = (await res.json()) as { id: string; status: string; exit_code: number | null; output: Entry[]; next_offset: number };
  let text = joinOutput(data.output);
  let offset = data.next_offset;
  // Poll a little longer if still running (long commands).
  for (let i = 0; data.status === "running" && i < 4; i++) {
    const s = await fetch(`${httpBase(c)}/execute/${data.id}/status?wait=${waitSec}&offset=${offset}`, { headers: authHeaders(c), signal });
    if (!s.ok) break;
    data = (await s.json()) as typeof data;
    text += joinOutput(data.output);
    offset = data.next_offset;
  }
  return { status: data.status, exit_code: data.exit_code, output: text.trim() };
}

type Entry = { type: string; data: string };
const joinOutput = (entries: Entry[] | undefined): string => (entries || []).map((e) => e.data).join("");

/** Create an upstream interactive terminal session on a computer, returning its id. */
export async function createTerminal(c: Computer, cols: number, rows: number, cwd?: string): Promise<string> {
  const res = await fetch(`${httpBase(c)}/api/terminals`, { method: "POST", headers: authHeaders(c), body: JSON.stringify({ cols, rows, cwd }) });
  if (!res.ok) throw new Error(`create terminal failed (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

export async function deleteTerminal(c: Computer, sessionId: string): Promise<void> {
  await fetch(`${httpBase(c)}/api/terminals/${sessionId}`, { method: "DELETE", headers: authHeaders(c) }).catch(() => undefined);
}

/** Open a WebSocket to an upstream terminal session and perform first-message auth. */
export function connectTerminal(c: Computer, sessionId: string): WebSocket {
  const wsUrl = httpBase(c).replace(/^http/, "ws") + `/api/terminals/${sessionId}`;
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: c.api_key })));
  return ws;
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new Error(`models fetch failed (${res.status})`);
  const data = (await res.json()) as { data?: { id: string }[]; models?: { id: string }[] };
  const list = data.data || data.models || [];
  return list.map((m) => m.id).filter(Boolean).sort();
}

export function computerRowView(r: Row): Record<string, unknown> {
  return { id: r.id, name: r.name, base_url: r.base_url, has_key: Boolean(r.api_key) };
}
