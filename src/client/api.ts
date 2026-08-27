export type User = {
  id: number; username: string; display: string; is_admin: boolean;
  description: string; job_title: string; avatar: string; tour_complete: boolean;
};
export type Author = { kind: "user" | "bot" | "system"; id: number; name: string; avatar?: string; agent_id?: number | null };
export type Attachment = { id: number; name: string; mime: string; size: number; workspace_path?: string };
export type AgentProgress = { id: number; kind: "thinking" | "tool" | "status"; body: string; status: "running" | "complete" | "failed"; created: number; updated: number };
export type ThreadUsage = { input_tokens: number; output_tokens: number; cached_input_tokens: number; model_calls: number };
export type AgentQuestionOption = { label: string; description?: string };
export type AgentQuestion = { id: string; header?: string; question: string; multi_select?: boolean; options: AgentQuestionOption[] };
export type AgentQuestions = {
  kind?: string;
  intro?: string; questions: AgentQuestion[]; status: "pending" | "answered" | "cancelled";
  answers?: Array<{ question_id: string; question: string; values: string[]; custom: string }> | null;
  answered?: number | null;
};
export type Message = { id: number; channel_id: number; parent_id: number | null; body: string; created: number; reply_count: number; last_reply: number | null; author: Author; attachments: Attachment[]; completed_at?: number | null; progress?: AgentProgress[]; progress_count?: number; questions?: AgentQuestions | null; photon_conversation_id?: number | null; workflow_id?: number | null; transport?: "inbound" | "outbound" | "app" };
export type ModelPolicy = {
  provider_id: number | null; provider_name: string | null; provider_kind: string | null;
  model: string; requested_model?: string; source?: "thread" | "workflow" | "channel" | "personal" | "workspace" | "agent";
  source_label?: string; personal_model?: string | null; workspace_model?: string;
  overridden: boolean; editable: boolean;
};
export type ResidentAgent = {
  id: number; bot_id: number; kind: "channel" | "skipper"; name: string; display_name: string;
  status: "ready" | "working" | "waiting" | "paused" | "archived";
  purpose: string; model: string; workflow_model?: string; provider_id: number | null; provider_name: string | null; provider_kind: string | null;
  capabilities: string[]; skills: Skill[]; runtime?: Bot;
};
export type ChannelComputer = {
  backend: "apple" | "oci" | "native" | "mock"; machine_id: string; desired_state: string; observed_state: string;
  cpus: number; memory_bytes: number; mirror_quota_bytes: number; mirror_quota_purpose: string;
  guest_disk_capacity_bytes: number | null; guest_disk_capacity_status: "unknown" | "known";
  home_mount: "none"; provision_status: string;
  maintenance_state: string; last_health: number; last_used: number; last_error: string;
  pressure?: { load1: number; memoryAvailableKb: number; memoryAvailableBytes: number; diskUsedPercent: number; sampledAt: number | null; status: "live" | "last_known" };
  pressure_status: "live" | "last_known" | "unknown";
  obligations: Array<{ kind: string; ref: string; mode: "resident" | "wakeable"; details: string; due_at?: number | null }>;
};
export type ChannelMember = { id: number; username: string; display: string; avatar: string };
export type Channel = { id: number; name: string; slug: string; kind: string; topic: string; purpose: string; status: "active" | "archived"; unread: number; favorite?: boolean; members?: ChannelMember[]; agent: ResidentAgent | null; computer?: ChannelComputer | null; personal_main?: boolean; can_manage?: boolean; detailed?: boolean; call_skipper_without_confirmation?: boolean };
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
  /** Active durable agent wake, pending or currently running (Board Scheduled lane). */
  followup?: ThreadFollowup | null;
};
export type GlobalThread = ThreadState & { channel_name: string; channel_slug: string; unread: boolean };
export type TextConversation = { id: number; sender: string; root_message_id: number; thread_id: number; active: number; started: number; updated: number; closed?: number | null; title: string; summary: string; status: string; last_body?: string; message_count?: number; messages?: Message[] };
export type ChannelFile = { path: string; name: string; size: number; modified: number; kind: "file" | "directory" };
export type MemoryItem = { id: number; channel_id: number; thread_id: number | null; root_message_id?: number | null; kind: "summary" | "decision" | "fact" | "preference" | "artifact_ref"; content: string; author_type: string; scope: string; status: "current" | "superseded"; created: number };
export type ActivityItem = {
  id: number; channel_id: number; thread_id: number | null; action_id?: number | null;
  kind: string; summary: string; status: string; actor_type: string; created: number; updated?: number;
  action_tool?: string | null; action_input?: string | null; action_result?: string | null;
};
export type Computer = { id: number; name: string; base_url: string; has_key: boolean };
export type ChannelComputerPrepare = {
  status: "idle" | "running" | "complete" | "failed";
  step: string;
  progress: number;
  error: string;
  image: string;
  started_at: number;
  updated_at: number;
};
export type ChannelRuntime = {
  backend: "apple" | "oci" | "native" | "mock"; supported: boolean; ready: boolean;
  engine_ready?: boolean; image_ready?: boolean; image?: string | null;
  prepare?: ChannelComputerPrepare | null;
  platform?: string; architecture?: string; darwin?: boolean; arm64?: boolean; macos_version?: string | null;
  cli?: string | null; version?: unknown; system?: unknown; runtime_version?: string | null;
  installer_url?: string; installer_sha256?: string; shared_runtime?: string | null; storage_authority?: string | null;
  status?: string; error?: string | null; development_only?: boolean;
};
export type Provider = { id: number; name: string; base_url: string; kind: string; has_key: boolean; bots: number };
export type RoutingProviderModel = { id: string; gatewayId: string; name: string; enabled: boolean };
export type RoutingDiscoveredModel = { id: string; name: string; free?: boolean; pricing?: Record<string, string | number | null> };
export type RoutingModel = { id: string; name: string; kind: "model" | "route"; providerId?: string; providerType?: string; providerName?: string; accountCount?: number };
export type RoutingModelGroup = { key: string; label: string; models: RoutingModel[] };

/** Stable selector group for one routed model. Named routes stay one group.
 * The server sets providerId only on custom/OpenAI-compatible sources, so
 * those stay individually selectable while branded families (OpenRouter,
 * NVIDIA, ChatGPT…) keep pooling every connected account into one entry via
 * the provider-type fallback. */
export function routingModelGroupKey(model: RoutingModel): string {
  if (model.kind === "route") return "routes";
  if (model.providerId) return `provider:${model.providerId}`;
  return String(model.providerType || model.providerName || "models");
}

/** The one grouping used by every model selection surface (welcome tour,
 * personal/workspace policy, thread popover, channel settings). Option values
 * remain the collision-safe routed model IDs; groups only organize them.
 * Providers sharing a display name get a numbered suffix so labels stay
 * unambiguous. */
export function groupRoutingModels(models: RoutingModel[]): RoutingModelGroup[] {
  const groups = new Map<string, RoutingModelGroup>();
  for (const model of models || []) {
    const key = routingModelGroupKey(model);
    const label = model.kind === "route" ? "Named routes" : String(model.providerName || model.providerType || "Provider");
    const group = groups.get(key);
    if (group) group.models.push(model);
    else groups.set(key, { key, label, models: [model] });
  }
  const ordered = [...groups.values()];
  const labelCounts = new Map<string, number>();
  for (const group of ordered) labelCounts.set(group.label, (labelCounts.get(group.label) || 0) + 1);
  const labelIndex = new Map<string, number>();
  for (const group of ordered) {
    if ((labelCounts.get(group.label) || 1) < 2) continue;
    const index = (labelIndex.get(group.label) || 0) + 1;
    labelIndex.set(group.label, index);
    group.label = `${group.label} (${index})`;
  }
  return ordered;
}
export type RoutingProvider = {
  id: string; type: string; name: string; accountAlias?: string | null; email?: string | null;
  profileName?: string | null; enabled: boolean; hasToken: boolean; baseUrl?: string;
  models: RoutingProviderModel[];
  visibility?: "personal" | "workspace"; mine?: boolean;
 imageGenerationEnabled?: boolean; };
export type RoutingComboMember = { providerType?: string; providerId?: string; model: string };
export type RoutingCombo = { id: string; storageId?: string | null; name: string; strategy: "fallback" | "round-robin"; members: RoutingComboMember[]; visibility?: "personal" | "workspace"; mine?: boolean };
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
  directEndpoint?: string; personalPort?: number | null; scope?: "captain" | "member";
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

let token = "";
export const getToken = (): string => token;
export async function initializeApiTransport(): Promise<void> { token = await initializeMobileRuntime(); setAuthenticatedAssetToken(token); }

/** Workspace photo is auth-gated; <img> cannot send Bearer — attach session token. */
export function workspacePhotoSrc(photoUrl: string | null | undefined, cacheBust?: string | number): string {
  if (!photoUrl) return "/brand/1helm-sailboat.png";
  const t = getToken();
  const params = new URLSearchParams();
  if (t) params.set("token", t);
  const source = serverAssetUrl(photoUrl);
  if (cacheBust === "sidebar") params.set("size", "sidebar");
  else if (cacheBust != null && cacheBust !== "" && !new URL(source, location.origin).searchParams.has("v")) params.set("v", String(cacheBust));
  const q = params.toString();
  return q ? `${source}${source.includes("?") ? "&" : "?"}${q}` : source;
}

export const setToken = async (t: string): Promise<void> => { token = t; setAuthenticatedAssetToken(t); await persistSecureSession(t); };
export const clearToken = async (): Promise<void> => { token = ""; setAuthenticatedAssetToken(""); await removeSecureSession(); };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
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
  const response = await fetch(apiUrl(path), { headers: token ? { authorization: `Bearer ${token}` } : {} });
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
  const res = await fetch(apiUrl("/api/upload"), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) }, body: file });
  const data = await res.json();
  return { token: data.token, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
}

/** Upload bytes without coupling the request lifetime to the view that selected
 * the file. XMLHttpRequest is used here because fetch does not expose browser
 * upload progress. */
export function uploadFileWithProgress(file: File, onProgress: (sent: number, total: number) => void): Promise<{ token: string; name: string; mime: string; size: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", apiUrl("/api/upload"));
    if (token) request.setRequestHeader("authorization", `Bearer ${token}`);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.setRequestHeader("x-filename", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : file.size);
    request.onerror = () => reject(new Error("The upload connection failed."));
    request.onabort = () => reject(new Error("The upload was cancelled."));
    request.onload = () => {
      let data: { token?: string; error?: string } = {};
      try { data = JSON.parse(request.responseText || "{}"); } catch { /* handled below */ }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || `Upload failed with HTTP ${request.status}.`));
        return;
      }
      if (!data.token) { reject(new Error("The upload did not return a file token.")); return; }
      onProgress(file.size, file.size);
      resolve({ token: data.token, name: file.name, mime: file.type || "application/octet-stream", size: file.size });
    };
    request.send(file);
  });
}

type Handler = (msg: any) => void;
export type EventSocketHooks = {
  onOpen?: () => void;
  onClose?: () => void;
};

/** Single app-event socket with auto-reconnect. onOpen fires on every successful (re)connect so the UI can resync. */
export function connectEvents(onMessage: Handler, hooks: EventSocketHooks = {}): WebSocket {
  const socketToken = token;
  const ws = new WebSocket(serverWebSocketUrl(`/ws?token=${encodeURIComponent(token)}`));
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onopen = () => { hooks.onOpen?.(); };
  ws.onclose = () => {
    hooks.onClose?.();
    if (socketToken && token === socketToken) setTimeout(() => {
      if (token === socketToken) connectEvents(onMessage, hooks);
    }, 1500);
  };
  return ws;
}
import { apiUrl, initializeMobileRuntime, persistSecureSession, removeSecureSession, serverAssetUrl, serverWebSocketUrl, setAuthenticatedAssetToken } from "./mobile.ts";
