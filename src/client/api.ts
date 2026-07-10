export type User = { id: number; username: string; display: string; is_admin: boolean };
export type Author = { kind: "user" | "bot"; id: number; name: string };
export type Attachment = { id: number; name: string; mime: string; size: number };
export type Message = { id: number; channel_id: number; parent_id: number | null; body: string; created: number; reply_count: number; last_reply: number | null; author: Author; attachments: Attachment[] };
export type Channel = { id: number; name: string; kind: string; topic: string; unread: number };
export type Bot = { id: number; name: string; model: string; prompt: string; avatar: string; provider_id: number | null; provider_name: string | null; provider_kind: string | null; computers: number[]; prefs: Record<string, string> };
export type Computer = { id: number; name: string; base_url: string; has_key: boolean };
export type Provider = { id: number; name: string; base_url: string; kind: string; has_key: boolean; bots: number };

let token = localStorage.getItem("ctrl.token") || "";
export const getToken = (): string => token;
export const setToken = (t: string): void => { token = t; localStorage.setItem("ctrl.token", t); };
export const clearToken = (): void => { token = ""; localStorage.removeItem("ctrl.token"); };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export async function uploadFile(file: File): Promise<{ token: string; name: string; mime: string; size: number }> {
  const res = await fetch("/api/upload", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) }, body: file });
  const data = await res.json();
  return { token: data.token, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
}

type Handler = (msg: any) => void;
export function connectEvents(onMessage: Handler): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onclose = () => setTimeout(() => connectEvents(onMessage), 1500);
  return ws;
}
