export type User = {
  id: number; username: string; display: string; is_admin: boolean;
  description: string; job_title: string; avatar: string; tour_complete: boolean;
};
export type Author = { kind: "user" | "bot" | "system"; id: number; name: string };
export type Attachment = { id: number; name: string; mime: string; size: number };
export type AgentProgress = { id: number; kind: "thinking" | "tool" | "status"; body: string; status: "running" | "complete" | "failed"; created: number; updated: number };
export type ThreadUsage = { input_tokens: number; output_tokens: number };
export type AgentQuestionOption = { label: string; description?: string };
export type AgentQuestion = { id: string; header?: string; question: string; multi_select?: boolean; options: AgentQuestionOption[] };
export type AgentQuestions = {
  intro?: string; questions: AgentQuestion[]; status: "pending" | "answered" | "cancelled";
  answers?: Array<{ question_id: string; question: string; values: string[]; custom: string }> | null;
  answered?: number | null;
};
export type Message = { id: number; channel_id: number; parent_id: number | null; body: string; created: number; reply_count: number; last_reply: number | null; author: Author; attachments: Attachment[]; progress?: AgentProgress[]; questions?: AgentQuestions | null };
export type ModelPolicy = { provider_id: number | null; provider_name: string | null; provider_kind: string | null; model: string; overridden: boolean; editable: boolean };
export type ResidentAgent = {
  id: number; bot_id: number; kind: "channel" | "skipper"; name: string; display_name: string;
  status: "ready" | "working" | "waiting" | "paused" | "archived";
  purpose: string; model: string; provider_id: number | null; provider_name: string | null; provider_kind: string | null;
  capabilities: string[]; skills: Skill[]; runtime?: Bot;
};
export type ChannelComputer = {
  backend: "apple" | "native" | "mock"; machine_id: string; desired_state: string; observed_state: string;
  cpus: number; memory_bytes: number; disk_bytes: number; home_mount: "none"; provision_status: string;
  maintenance_state: string; last_health: number; last_used: number; last_error: string;
  obligations: Array<{ kind: string; ref: string; mode: "resident" | "wakeable"; details: string; due_at?: number | null }>;
};
export type Channel = { id: number; name: string; slug: string; kind: string; topic: string; purpose: string; status: "active" | "archived"; unread: number; agent: ResidentAgent | null; computer?: ChannelComputer | null; personal_main?: boolean; can_manage?: boolean };
export type Bot = { id: number; name: string; model: string; avatar: string; provider_id: number | null; provider_name: string | null; provider_kind: string | null; computers: number[]; prefs: Record<string, string>; agent_id?: number | null; agent_kind?: string | null; agent_status?: string | null; resident_channel_id?: number | null };
export type ThreadFollowup = {
  id: number;
  due_at: number;
  reason: string;
  attempts: number;
  max_attempts: number;
  status: string;
  check_hint?: string;
};
export type ThreadState = {
  id: number;
  root_message_id: number;
  channel_id: number;
  status: "open" | "waiting" | "resolved" | "failed" | "archived";
  title: string;
  summary: string;
  opened_at: number;
  updated_at: number;
  root: Message;
  /** Next pending durable agent wake, if any (Board Scheduled lane + countdown). */
  followup?: ThreadFollowup | null;
};
export type GlobalThread = ThreadState & { channel_name: string; channel_slug: string; unread: boolean };
export type ChannelFile = { path: string; name: string; size: number; modified: number; kind: "file" | "directory" };
export type MemoryItem = { id: number; channel_id: number; thread_id: number | null; root_message_id?: number | null; kind: "summary" | "decision" | "fact" | "preference" | "artifact_ref"; content: string; author_type: string; scope: string; status: "current" | "superseded"; created: number };
export type ActivityItem = {
  id: number; channel_id: number; thread_id: number | null; action_id?: number | null;
  kind: string; summary: string; status: string; actor_type: string; created: number; updated?: number;
  action_tool?: string | null; action_input?: string | null; action_result?: string | null;
};
export type Computer = { id: number; name: string; base_url: string; has_key: boolean };
export type ChannelRuntime = {
  backend: "apple" | "native" | "mock"; supported: boolean; darwin: boolean; arm64: boolean; macos_version?: string | null;
  cli: string | null; version?: unknown; system: unknown; runtime_version: string; installer_url: string; installer_sha256: string; ready: boolean;
};
export type Provider = { id: number; name: string; base_url: string; kind: string; has_key: boolean; bots: number };
export type RoutingProviderModel = { id: string; gatewayId: string; name: string; enabled: boolean };
export type RoutingModel = { id: string; name: string; kind: "model" | "route"; providerType?: string; providerName?: string; accountCount?: number };
export type RoutingProvider = {
  id: string; type: string; name: string; accountAlias?: string | null; email?: string | null;
  profileName?: string | null; enabled: boolean; hasToken: boolean; baseUrl?: string;
  models: RoutingProviderModel[];
 imageGenerationEnabled?: boolean; };
export type RoutingComboMember = { providerType?: string; providerId?: string; model: string };
export type RoutingCombo = { id: string; storageId?: string | null; name: string; strategy: "fallback" | "round-robin"; members: RoutingComboMember[] };
export type RoutingUsageEntry = {
  at?: number; model?: string; provider?: string; providerName?: string; providerType?: string;
  accountAlias?: string | null; status?: number; requests?: number; prompt_tokens?: number;
  completion_tokens?: number; cached_tokens?: number; total_tokens?: number; error?: unknown;
};
export type RoutingUsage = {
  requests: number; ok: number; errors: number; prompt_tokens: number; completion_tokens: number;
  cached_tokens: number; total_tokens: number; byModel: RoutingUsageEntry[];
  byProvider: RoutingUsageEntry[]; recent: RoutingUsageEntry[];
};
export type RoutingQuotaWindow = { id: string; label: string; usedPercent: number; remainingPercent: number; resetsAt?: number | null };
export type RoutingQuotaAccount = {
  providerId: string; providerType?: string; type?: string; name?: string; accountAlias?: string | null; email?: string | null;
  supported?: boolean; status?: string; note?: string; error?: string; plan?: string | null; windows?: RoutingQuotaWindow[];
};
export type RoutingState = {
  appVersion: string; endpoint: string; bindHost: string; port: number; serverListening: boolean;
  apiKey: string; apiKeys: Array<{ id: string; name: string; key: string; enabled: boolean; createdAt: number }>;
  providers: RoutingProvider[]; combos: RoutingCombo[]; usage: RoutingUsage;
  activeRequests: unknown[]; recentActivity?: unknown[]; imageGenerationEnabled?: boolean; oauthProviders: Array<{ id: string; name: string }>;
  keyedPresets: Array<{ id: string; name: string; baseUrl: string; needsAccountId?: boolean }>;
};

export async function routingAction<T = Record<string, unknown>>(action: string, payload?: unknown): Promise<T> {
  return api<T>("/api/routing/action", { body: { action, payload } });
}
export type Skill = {
  id?: number; slug: string; name: string; description: string; category: string; instructions?: string; assigned?: boolean;
  source?: string; trust_level?: string; provenance_url?: string; provenance_identifier?: string; provenance_revision?: string;
  content_sha256?: string; scan_status?: string; installed_at?: number;
};
export type SkillCatalogStatus = {
  available: boolean; source: string; generated_at: string; refreshed_at: number; skill_count: number;
  builtin: number; trusted: number; community: number; error: string;
};
export type SkillCatalogResult = {
  name: string; description: string; source: string; identifier: string; trust_level: string;
  repo?: string; path?: string; tags?: string[];
};
export type AgentTemplate = { id: number; slug: string; name: string; description: string; purpose_hint: string; skill_slugs: string[]; icon: string };
export type WorkspaceDomain = { id: number; hostname: string; provider: "cloudflare"; status: "connecting" | "active" | "error"; error: string; verified: number | null };
export type Collaboration = {
  enabled: boolean; slug: string; hostname: string; status: "off" | "provisioning" | "active" | "error";
  error: string; accept_new_requests: boolean; custom_domain: string; primary_url: string; connector_available: boolean;
};
export type AccessRequest = { id: number; email: string; display: string; status: "pending" | "approved" | "denied" | "claimed"; requested_at: number; reviewed_at: number | null };
export type Workspace = { name: string; terminals_enabled: boolean; setup_complete: boolean; photo_url: string | null; theme: "graphite" | "ocean" | "forest" | "ember" | "plum" };

let token = localStorage.getItem("ctrl.token") || "";
export const getToken = (): string => token;

/** Workspace photo is auth-gated; <img> cannot send Bearer — attach session token. */
export function workspacePhotoSrc(photoUrl: string | null | undefined, cacheBust?: string | number): string {
  if (!photoUrl) return "/brand/1helm-sailboat.png";
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
  const { blob, name } = await authenticatedFile(path);
  const url = URL.createObjectURL(blob);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay fixed inset-0 z-[90] grid place-items-center bg-black/70 p-3 sm:p-6";
  overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", `Preview ${name}`);
  const card = document.createElement("section");
  card.className = "card flex h-[min(92dvh,1000px)] w-full max-w-6xl flex-col overflow-hidden shadow-2xl";
  const head = document.createElement("div"); head.className = "flex items-center gap-3 border-b border-line px-4 py-3";
  const title = document.createElement("div"); title.className = "min-w-0 flex-1 truncate font-semibold text-fg"; title.textContent = name;
  const download = document.createElement("button"); download.type = "button"; download.className = "btn-primary text-sm"; download.textContent = "Download";
  download.onclick = () => saveBlob(blob, name);
  const closeButton = document.createElement("button"); closeButton.type = "button"; closeButton.className = "btn-subtle text-sm"; closeButton.textContent = "Close";
  const close = (): void => { overlay.remove(); URL.revokeObjectURL(url); };
  closeButton.onclick = close; overlay.onclick = (event) => { if (event.target === overlay) close(); };
  const content = document.createElement("div"); content.className = "min-h-0 flex-1 overflow-auto bg-black/5 p-3";
  if (blob.type.startsWith("image/")) {
    const image = document.createElement("img"); image.src = url; image.alt = name; image.className = "mx-auto max-h-full max-w-full rounded object-contain"; content.append(image);
  } else if (blob.type === "application/pdf") {
    const frame = document.createElement("iframe"); frame.src = url; frame.title = name; frame.className = "h-full min-h-[70dvh] w-full rounded bg-white"; content.append(frame);
  } else if (blob.type.startsWith("text/") || /(?:json|xml|javascript|typescript|yaml)/i.test(blob.type)) {
    const pre = document.createElement("pre"); pre.className = "m-0 whitespace-pre-wrap break-words font-mono text-xs text-fg"; pre.textContent = await blob.text(); content.append(pre);
  } else if (blob.type.startsWith("video/")) {
    const media = document.createElement("video"); media.src = url; media.controls = true; media.className = "mx-auto max-h-full max-w-full"; content.append(media);
  } else if (blob.type.startsWith("audio/")) {
    const media = document.createElement("audio"); media.src = url; media.controls = true; media.className = "mx-auto w-full max-w-2xl"; content.append(media);
  } else {
    const note = document.createElement("div"); note.className = "grid h-full place-items-center text-center text-sm text-muted"; note.textContent = "This file type has no safe in-app preview. Download it to open in another application."; content.append(note);
  }
  head.append(title, download, closeButton); card.append(head, content); overlay.append(card); document.body.append(overlay); closeButton.focus();
}

async function authenticatedFile(path: string): Promise<{ blob: Blob; name: string }> {
  const response = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `HTTP ${response.status}`);
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : plain || decodeURIComponent(path.split("/").pop()?.split("?")[0] || "download");
  return { blob: await response.blob(), name };
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name || "download"; link.hidden = true;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadAuthenticatedFile(path: string, preferredName?: string): Promise<void> {
  const file = await authenticatedFile(path);
  saveBlob(file.blob, preferredName || file.name);
}

export async function uploadFile(file: File): Promise<{ token: string; name: string; mime: string; size: number }> {
  const res = await fetch("/api/upload", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) }, body: file });
  const data = await res.json();
  return { token: data.token, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
}

type Handler = (msg: any) => void;
export type EventSocketHooks = {
  onOpen?: () => void;
  onClose?: () => void;
};

/** Single app-event socket with auto-reconnect. onOpen fires on every successful (re)connect so the UI can resync. */
export function connectEvents(onMessage: Handler, hooks: EventSocketHooks = {}): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onopen = () => { hooks.onOpen?.(); };
  ws.onclose = () => {
    hooks.onClose?.();
    setTimeout(() => connectEvents(onMessage, hooks), 1500);
  };
  return ws;
}
