export type User = { id: number; username: string; display: string; is_admin: boolean };
export type Author = { kind: "user" | "bot"; id: number; name: string };
export type Attachment = { id: number; name: string; mime: string; size: number };
export type AgentProgress = { id: number; kind: "thinking" | "tool" | "status"; body: string; status: "running" | "complete" | "failed"; created: number; updated: number };
export type Message = { id: number; channel_id: number; parent_id: number | null; body: string; created: number; reply_count: number; last_reply: number | null; author: Author; attachments: Attachment[]; progress?: AgentProgress[] };
export type ModelPolicy = { provider_id: number | null; provider_name: string | null; provider_kind: string | null; model: string; overridden: boolean; editable: boolean };
export type ResidentAgent = {
  id: number; bot_id: number; kind: "channel" | "skipper"; name: string; display_name: string;
  status: "ready" | "working" | "waiting" | "paused" | "archived";
  purpose: string; model: string; provider_id: number | null; provider_name: string | null; provider_kind: string | null;
  capabilities: string[]; skills: Skill[]; runtime?: Bot;
};
export type Channel = { id: number; name: string; slug: string; kind: string; topic: string; purpose: string; status: "active" | "archived"; unread: number; agent: ResidentAgent | null };
export type Bot = { id: number; name: string; model: string; prompt: string; avatar: string; provider_id: number | null; provider_name: string | null; provider_kind: string | null; computers: number[]; prefs: Record<string, string>; agent_id?: number | null; agent_kind?: string | null; agent_status?: string | null; resident_channel_id?: number | null };
export type ThreadState = { id: number; root_message_id: number; channel_id: number; status: "open" | "waiting" | "resolved" | "failed" | "archived"; title: string; summary: string; opened_at: number; updated_at: number; root: Message };
export type ChannelFile = { path: string; name: string; size: number; modified: number; kind: "file" | "directory" };
export type MemoryItem = { id: number; channel_id: number; thread_id: number | null; root_message_id?: number | null; kind: "summary" | "decision" | "fact" | "preference" | "artifact_ref"; content: string; author_type: string; scope: string; status: "current" | "superseded"; created: number };
export type ActivityItem = { id: number; channel_id: number; thread_id: number | null; kind: string; summary: string; status: string; actor_type: string; created: number };
export type Computer = { id: number; name: string; base_url: string; has_key: boolean };
export type Provider = { id: number; name: string; base_url: string; kind: string; has_key: boolean; bots: number };
export type Skill = { id?: number; slug: string; name: string; description: string; category: string; instructions?: string; assigned?: boolean };
export type AgentTemplate = { id: number; slug: string; name: string; description: string; purpose_hint: string; skill_slugs: string[]; icon: string };
export type WorkspaceDomain = { id: number; hostname: string; provider: "cloudflare"; status: "connecting" | "active" | "error"; error: string; verified: number | null };
export type Workspace = { name: string; terminals_enabled: boolean; setup_complete: boolean; photo_url: string | null; theme: "graphite" | "ocean" | "forest" | "ember" | "plum" };

let token = localStorage.getItem("ctrl.token") || "";
export const getToken = (): string => token;

/** Workspace photo is auth-gated; <img> cannot send Bearer — attach session token. */
export function workspacePhotoSrc(photoUrl: string | null | undefined, cacheBust?: string | number): string {
  if (!photoUrl) return "/brand/1helm.png";
  const t = getToken();
  const params = new URLSearchParams();
  if (t) params.set("token", t);
  if (cacheBust != null && cacheBust !== "") params.set("v", String(cacheBust));
  const q = params.toString();
  return q ? `${photoUrl}${photoUrl.includes("?") ? "&" : "?"}${q}` : photoUrl;
}
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

export async function openAuthenticatedFile(path: string): Promise<void> {
  const preview = window.open("about:blank", "_blank");
  if (preview) preview.opener = null;
  try {
    const response = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `HTTP ${response.status}`);
    const url = URL.createObjectURL(await response.blob());
    if (preview) preview.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    preview?.close();
    throw error;
  }
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
