import { api, downloadAuthenticatedFile, openAuthenticatedFile, uploadFile, connectEvents, getToken, setToken, clearToken, workspacePhotoSrc, type User, type Channel, type Message, type Bot, type Computer, type Provider, type Workspace, type ModelPolicy, type AgentProgress, type AgentQuestions, type ThreadFollowup, type ThreadUsage, type RoutingModel } from "./api.ts";
import { h, clear, add, md, color, initials, timeLabel, dayLabel, sameDay, icon, helmMark, type ChannelLink } from "./dom.ts";
import { openSettings, finishOpenRouterOAuth, refreshOpenSkillsSettings } from "./settings.ts";
import { hydrateNotificationPreferences, playNotification } from "./notifications.ts";
import { openRoutingPopover, pushRoutingActivity } from "./routing.ts";
import { openOnboarding } from "./onboarding.ts";
import { defaultTerminalComputer, openTerminals, refitChannelTerminals, getTerminalChrome } from "./term.ts";
import { openCreateChannel, renderActivity, renderBoard, renderChannelSettings, renderFiles, renderGlobalThreads, renderMemory, renderNotes, renderTexts, renderThreads, type ChannelView } from "./channel.ts";

/** Per-channel layout bound to the user profile (server user_ui_state). */
type ChannelUiView = {
  terminalOpen: boolean;
  notesOpen: boolean;
  serversListOpen: boolean;
  preferredComputerId: number | null;
  threadRootId: number | null;
};
type State = {
  me: User; users: User[]; channels: Channel[]; bots: Bot[]; computers: Computer[]; providers: Provider[];
  workspace: Workspace;
  channelId: number; channelBots: Bot[]; messages: Message[];
  threadRoot: Message | null; threadReplies: Message[]; view: ChannelView;
  /** Cumulative provider-reported model usage for the open thread. */
  threadUsage: ThreadUsage;
  /** The same next persisted wake exposed on Board for the open thread. */
  threadFollowup: ThreadFollowup | null;
  mobileMenuOpen: boolean;
  preferredTerminalComputerId: number | null;
  /** Docked RHS terminal for the current channel (header Terminals button). */
  terminalOpen: boolean;
  /** Docked RHS Markdown notes for the current channel (header Notes button). */
  notesOpen: boolean;
  serversListOpen: boolean;
  /** Profile-bound per-channel layout: key = channelId. */
  channelViews: Record<number, ChannelUiView>;
  /** Workspace-wide Threads inbox (sidebar), not the per-channel Threads tab. */
  globalThreadsOpen: boolean;
  globalThreadsUnreadOnly: boolean;
  /** Profile-bound sidebar preference loaded from /api/me/ui-state. */
  groupUnreadChannelsFirst: boolean;
  photonConfigured: boolean;
  selectedTextConversationId: number | null;
};
export const S = {
  mobileMenuOpen: false,
  preferredTerminalComputerId: null,
  terminalOpen: false,
  notesOpen: false,
  serversListOpen: false,
  channelViews: {},
  globalThreadsOpen: false,
  globalThreadsUnreadOnly: false,
  groupUnreadChannelsFirst: false,
  photonConfigured: false,
  selectedTextConversationId: null,
  threadUsage: { input_tokens: 0, output_tokens: 0 },
  threadFollowup: null,
} as State;

/** One-shot: next chat/thread paint must land on latest messages (channel open / hop). */
let forceMsgsScrollBottom = false;
let forceThreadScrollBottom = false;
/** Carry channel scroll across shell rebuilds (open/close thread destroys #msgs). */
let pendingMsgsScroll: { top: number; stick: boolean } | null = null;
/** Last successful channel stick state — survives same-turn re-render before rAF pin lands. */
let lastMsgsStick = true;

/** After layout settles, pin a scroller to the end (fresh #msgs often has clientHeight before flex height). */
function pinScrollBottom(id: string, frames = 2): void {
  const run = (left: number): void => {
    const box = document.getElementById(id);
    if (box) box.scrollTop = box.scrollHeight;
    if (left > 0) requestAnimationFrame(() => run(left - 1));
  };
  requestAnimationFrame(() => run(Math.max(0, frames - 1)));
}

const defaultChannelView = (): ChannelUiView => ({
  terminalOpen: false,
  notesOpen: false,
  serversListOpen: false,
  preferredComputerId: null,
  threadRootId: null,
});
function channelViewKey(channelId: number): string { return `channel_view:${channelId}`; }
function getChannelView(channelId: number): ChannelUiView {
  return S.channelViews[channelId] || defaultChannelView();
}
function applyChannelViewToState(channelId: number): void {
  const view = getChannelView(channelId);
  S.terminalOpen = !!view.terminalOpen;
  S.notesOpen = !!view.notesOpen;
  S.serversListOpen = !!view.serversListOpen;
  S.preferredTerminalComputerId = view.preferredComputerId;
}
let uiStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersistChannelView(channelId: number): void {
  if (!channelId || !S.me?.id) return;
  const snapshot: ChannelUiView = channelId === S.channelId
      ? {
        terminalOpen: !!S.terminalOpen,
        notesOpen: !!S.notesOpen,
        serversListOpen: !!S.serversListOpen,
        preferredComputerId: S.preferredTerminalComputerId,
        threadRootId: S.threadRoot?.id ?? null,
      }
    : { ...getChannelView(channelId) };
  S.channelViews[channelId] = snapshot;
  if (uiStateSaveTimer) clearTimeout(uiStateSaveTimer);
  uiStateSaveTimer = setTimeout(() => {
    uiStateSaveTimer = null;
    void api("/api/me/ui-state", {
      method: "PATCH",
      body: { key: channelViewKey(channelId), value: snapshot },
    }).catch(() => undefined);
  }, 300);
}
function persistCurrentChannelView(): void {
  if (S.channelId) schedulePersistChannelView(S.channelId);
}
async function loadUiState(): Promise<void> {
  try {
    const result = await api<{ state: Record<string, unknown> }>("/api/me/ui-state");
    hydrateNotificationPreferences(result.state.notification_preferences);
    S.groupUnreadChannelsFirst = result.state.group_unread_channels_first === true;
    const next: Record<number, ChannelUiView> = {};
    for (const [key, value] of Object.entries(result.state || {})) {
      const match = /^channel_view:(\d+)$/.exec(key);
      if (!match || !value || typeof value !== "object") continue;
      const raw = value as Partial<ChannelUiView>;
      next[Number(match[1])] = {
        terminalOpen: !!raw.terminalOpen,
        notesOpen: !!raw.notesOpen,
        serversListOpen: !!raw.serversListOpen,
        preferredComputerId: raw.preferredComputerId == null ? null : Number(raw.preferredComputerId) || null,
        threadRootId: raw.threadRootId == null ? null : Number(raw.threadRootId) || null,
      };
    }
    S.channelViews = next;
  } catch {
    // Fresh profile / offline — keep defaults.
  }
}
const root = document.getElementById("app")!;
const pending: { token: string; name: string; mime: string; size: number }[] = [];

// ---------------- theme ----------------
export function currentTheme(): "light" | "dark" { return document.documentElement.classList.contains("light") ? "light" : "dark"; }
export function toggleTheme(): void {
  const next = currentTheme() === "light" ? "dark" : "light";
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(next);
  localStorage.setItem("ctrl.theme", next);
  window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  renderApp();
}

type AppRoute = { slug: string | null; view: ChannelView; threadRootId: number | null };
const VIEWS = new Set<ChannelView>(["chat", "texts", "board", "threads", "notes", "files", "terminal", "memory", "activity", "settings"]);
function readRoute(): AppRoute {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "c" || !parts[1]) return { slug: null, view: "chat", threadRootId: null };
  if (parts[2] === "thread" && /^\d+$/.test(parts[3] || "")) return { slug: decodeURIComponent(parts[1]), view: "chat", threadRootId: Number(parts[3]) };
  const view = VIEWS.has(parts[2] as ChannelView) ? parts[2] as ChannelView : "chat";
  return { slug: decodeURIComponent(parts[1]), view, threadRootId: null };
}
function writeRoute(channel: Channel | undefined, view: ChannelView, threadRootId: number | null, replace = false): void {
  if (!channel || channel.kind !== "channel") return;
  const path = threadRootId ? `/c/${encodeURIComponent(channel.slug)}/thread/${threadRootId}` : `/c/${encodeURIComponent(channel.slug)}/${view}`;
  if (location.pathname === path) return;
  history[replace ? "replaceState" : "pushState"]({}, "", path);
}

// ---------------- boot ----------------
export async function boot(): Promise<void> {
  const setup = await api<{ needs_setup: boolean; has_users: boolean; setup_complete: boolean; workspace: Workspace }>("/api/setup/status").catch(() => null);
  if (setup && !setup.has_users) return openOnboarding(root, { resume: false, onDone: () => boot() });
  if (!getToken()) return renderAuth();
  try {
    const me = await api<{ user: User; workspace: Workspace }>("/api/me");
    S.me = me.user;
    S.workspace = me.workspace;
  } catch { clearToken(); return renderAuth(); }
  // Complete OpenRouter OAuth before loading the workspace so a failed
  // channel/provider fetch cannot swallow the callback.
  const oauth = await finishOpenRouterOAuth();
  if (!S.workspace.setup_complete && S.me.is_admin) {
    return openOnboarding(root, { resume: true, resumeStep: oauth.connected ? 2 : 1, onDone: () => boot() });
  }
  await enterWorkspace();
}

async function enterWorkspace(preferredChannelId?: number): Promise<void> {
  S.messages = S.messages || []; S.channelBots = S.channelBots || []; S.view = "chat";
  if (!S.workspace) {
    try { S.workspace = (await api<{ workspace: Workspace }>("/api/workspace")).workspace; }
    catch { S.workspace = { name: "My Workspace", terminals_enabled: true, setup_complete: true, photo_url: null, theme: "graphite" }; }
  }
  await loadWorkspace();
  await loadUiState();
  let eventSocketReady = false;
  connectEvents(onEvent, {
    // After reconnect (not the first open), silently pull authoritative lists so no hard refresh is needed.
    onOpen: () => {
      if (!eventSocketReady) { eventSocketReady = true; return; }
      void resyncAfterReconnect();
    },
  });
  const route = readRoute();
  if (preferredChannelId) S.channelId = preferredChannelId;
  else if (route.slug) S.channelId = S.channels.find((channel) => channel.slug === route.slug)?.id || 0;
  const main = S.channels.find((c) => c.name === "main" && c.kind === "channel");
  if (!S.channelId && main) S.channelId = main.id;
  if (S.channelId) await openChannel(S.channelId, route.view, route.threadRootId, true);
  else renderApp();
  if (!S.me.tour_complete && sessionStorage.getItem("1helm.justOnboarded") === "1") {
    sessionStorage.removeItem("1helm.justOnboarded");
    void openWelcomeTour();
  }
}

async function openWelcomeTour(): Promise<void> {
  if (document.getElementById("welcome-tour")) return;
  let data: { model: string; models: RoutingModel[] };
  try { data = await api<{ model: string; models: RoutingModel[] }>("/api/workspace/model-policy"); }
  catch { return; }
  const overlay = h("div", { id: "welcome-tour", class: "modal-overlay fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" });
  const provider = h("select", { class: "field" }) as HTMLSelectElement;
  const model = h("select", { class: "field" }) as HTMLSelectElement;
  const families = new Map<string, { label: string; models: RoutingModel[] }>();
  for (const candidate of data.models || []) {
    const id = candidate.kind === "route" ? "routes" : String(candidate.providerType || candidate.providerName || "models");
    const label = candidate.kind === "route" ? "Named routes" : String(candidate.providerName || candidate.providerType || "Provider");
    const group = families.get(id) || { label, models: [] }; group.models.push(candidate); families.set(id, group);
  }
  for (const [id, group] of families) provider.append(h("option", { value: id, selected: group.models.some((candidate) => candidate.id === data.model) }, group.label));
  const drawModels = (): void => {
    clear(model); const group = families.get(provider.value);
    for (const candidate of group?.models || []) model.append(h("option", { value: candidate.id, selected: candidate.id === data.model }, candidate.name || candidate.id));
    if (!model.value && model.options.length) model.selectedIndex = 0;
  };
  provider.onchange = drawModels; drawModels();
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const finish = async (saveModel: boolean): Promise<void> => {
    status.textContent = saveModel ? "Saving your primary model…" : "Opening your workspace…";
    try {
      if (saveModel && model.value) await api("/api/workspace/model-policy", { method: "PATCH", body: { model: model.value } });
      S.me = (await api<{ user: User }>("/api/me/profile", { method: "PATCH", body: { tour_complete: true } })).user;
      await loadWorkspace(); renderApp(); overlay.remove();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  overlay.append(h("section", { class: "card w-full max-w-[820px] overflow-hidden shadow-2xl" },
    h("div", { class: "grid md:grid-cols-[1.15fr_.85fr]" },
      h("div", { class: "p-6 sm:p-8" }, h("div", { class: "eyebrow text-accent" }, "Welcome aboard"), h("h1", { class: "font-display mt-2 text-3xl text-fg" }, "Which model should be primary?"), h("p", { class: "mt-2 text-sm leading-6 text-muted" }, "1Helm already chose a working default so setup could finish. Pick the provider family and model you prefer now; you can change this anytime in #main settings."),
        h("div", { class: "mt-5 grid gap-3 sm:grid-cols-2" }, h("label", { class: "space-y-1 text-xs font-semibold text-fg" }, "Provider", provider), h("label", { class: "space-y-1 text-xs font-semibold text-fg" }, "Model", model)), status,
        h("div", { class: "mt-5 flex flex-wrap justify-end gap-2" }, h("button", { class: "btn-subtle", onclick: () => { void finish(false); } }, "Keep current"), h("button", { class: "btn-primary", onclick: () => { void finish(true); } }, "Use as primary"))),
      h("aside", { class: "border-t border-line bg-raised/50 p-6 md:border-l md:border-t-0 sm:p-8" }, h("div", { class: "eyebrow text-muted" }, "A 30-second tour"),
        ...[
          ["Channels are private worlds", "Every ordinary channel owns one resident agent, Linux computer, terminal, files, threads, and memory."],
          ["Skipper crosses boundaries", "Call @skipper when work needs another channel, a host operation, credentials, or a missing capability."],
          ["Providers work together", "Accounts and keys form one model fabric. Pick direct models or named routes without choosing one permanent AI brain."],
        ].map(([title, copy], index) => h("div", { class: "mt-5 flex gap-3" }, h("span", { class: "grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-xs text-accent" }, String(index + 1)), h("div", {}, h("h3", { class: "text-sm font-semibold text-fg" }, title), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, copy))))))));
  document.body.append(overlay);
}

/** Merge channel meta from the server without clobbering local per-user unread. */
function mergeChannelMeta(incoming: Partial<Channel> & { id: number }): void {
  if (!incoming?.id) return;
  const index = S.channels.findIndex((channel) => channel.id === incoming.id);
  if (index < 0) {
    S.channels = [...S.channels, { unread: 0, agent: null, purpose: "", topic: "", status: "active", slug: String(incoming.id), name: "", kind: "channel", ...incoming } as Channel];
    return;
  }
  const prev = S.channels[index];
  S.channels[index] = {
    ...prev,
    ...incoming,
    // Live payloads intentionally omit unread — keep the client's own counter.
    unread: typeof incoming.unread === "number" ? incoming.unread : prev.unread,
    agent: incoming.agent !== undefined ? incoming.agent : prev.agent,
  };
}

let resyncInFlight: Promise<void> | null = null;
async function resyncAfterReconnect(): Promise<void> {
  if (!getToken() || !S.me) return;
  if (resyncInFlight) return resyncInFlight;
  resyncInFlight = (async () => {
    try {
      const previousId = S.channelId;
      await loadWorkspace();
      // Keep the open channel's message list fresh if we were mid-view.
      if (previousId && S.channels.some((c) => c.id === previousId) && S.view === "chat") {
        const data = await api<{ messages: Message[]; bots: Bot[] }>(`/api/channels/${previousId}/messages`);
        if (S.channelId === previousId) {
          S.messages = data.messages;
          S.channelBots = data.bots;
        }
      }
      renderApp();
    } catch {
      // Offline / auth blip — next reconnect retries.
    } finally {
      resyncInFlight = null;
    }
  })();
  return resyncInFlight;
}

async function loadWorkspace(): Promise<void> {
  const [ch, us, bots, comps, provs, ws, photon] = await Promise.all([
    api<{ channels: Channel[] }>("/api/channels"),
    api<{ users: User[] }>("/api/users"),
    api<{ bots: Bot[] }>("/api/bots"),
    S.me.is_admin ? api<{ computers: Computer[] }>("/api/computers") : Promise.resolve({ computers: [] }),
    S.me.is_admin ? api<{ providers: Provider[] }>("/api/providers") : Promise.resolve({ providers: [] }),
    api<{ workspace: Workspace }>("/api/workspace").catch(() => ({ workspace: S.workspace })),
    S.me.is_admin ? api<{ photon: { configured: boolean } }>("/api/connectors/photon").catch(() => ({ photon: { configured: false } })) : Promise.resolve({ photon: { configured: false } }),
  ]);
  S.channels = ch.channels; S.users = us.users; S.bots = bots.bots; S.computers = comps.computers; S.providers = provs.providers;
  if (ws?.workspace) S.workspace = ws.workspace;
  S.photonConfigured = Boolean(photon?.photon?.configured);
  if (!S.channelId || !S.channels.find((c) => c.id === S.channelId)) {
    const main = S.channels.find((c) => c.name === "main" && c.kind === "channel");
    S.channelId = main?.id || S.channels[0]?.id || 0;
  }
}

async function openChannel(id: number, view: ChannelView = "chat", threadRootId: number | null = null, replaceRoute = false): Promise<void> {
  // Persist the channel we're leaving so terminal/thread docks survive hops.
  if (S.channelId && S.channelId !== id) persistCurrentChannelView();
  const requestedChannel = S.channels.find((channel) => channel.id === id);
  if (view === "texts" && !textsAvailable(requestedChannel)) view = "chat";
  S.channelId = id; S.threadRoot = null; S.threadFollowup = null; S.threadUsage = { input_tokens: 0, output_tokens: 0 }; S.view = view; S.globalThreadsOpen = false;
  applyChannelViewToState(id);
  // Full Terminal tab is separate from the docked header terminal.
  if (view === "terminal") S.terminalOpen = false;
  const data = await api<{ messages: Message[]; bots: Bot[] }>(`/api/channels/${id}/messages`);
  S.messages = data.messages; S.channelBots = data.bots;
  // GET /messages already advances last_read server-side; keep client badge in sync.
  const c = S.channels.find((x) => x.id === id); if (c) c.unread = 0;
  // Channel hop: always land on latest. Clear leftover work-log open flags from the previous channel.
  forceMsgsScrollBottom = view === "chat";
  forceThreadScrollBottom = false;
  lastMsgsStick = true;
  progressOpenByMessage.clear();
  renderApp();
  writeRoute(c, view, threadRootId, replaceRoute);
  // Explicit URL/threadRootId wins; otherwise restore profile-saved thread on channel hop.
  const savedThreadId = getChannelView(id).threadRootId;
  const openId = threadRootId != null ? threadRootId : (view === "chat" ? savedThreadId : null);
  if (openId) {
    const root = S.messages.find((message) => message.id === openId && message.parent_id == null);
    if (root) await openThread(root, replaceRoute || threadRootId == null);
  }
}
export async function reloadBots(): Promise<void> {
  S.bots = (await api<{ bots: Bot[] }>("/api/bots")).bots;
  S.channelBots = S.channelBots.map((x) => S.bots.find((y) => y.id === x.id) || x);
}
export async function reloadProviders(): Promise<void> { S.providers = (await api<{ providers: Provider[] }>("/api/providers")).providers; }

window.addEventListener("popstate", () => {
  const route = readRoute();
  const channel = route.slug ? S.channels?.find((item) => item.slug === route.slug) : undefined;
  if (channel) void openChannel(channel.id, route.view, route.threadRootId, true);
});

// ---------------- events ----------------
/** Agent turns mutate one message id (Working… → final). Only settled payloads badge unread. */
function messageIsSettled(msg: Message): boolean {
  if (!msg) return false;
  if (msg.author?.kind === "user") return true;
  const body = String(msg.body || "").trim();
  if (!body || body === "_Working…_") return false;
  // Any running work-log step means the turn is still live — even if body already has sticky text.
  if (msg.progress?.some((p) => p.status === "running")) return false;
  return true;
}

function markChannelRead(channelId: number): void {
  const c = S.channels.find((x) => x.id === channelId);
  if (c) c.unread = 0;
  // Fire-and-forget server last_read advance so Threads + sidebar stay aligned.
  void api(`/api/channels/${channelId}/read`, { method: "POST" }).catch(() => undefined);
}

function bumpChannelUnread(channelId: number): void {
  const c = S.channels.find((x) => x.id === channelId);
  if (!c) return;
  c.unread = Math.max(0, Number(c.unread) || 0) + 1;
  renderSidebar();
}

/** Message ids already counted for a live unread badge (agent reuses one id across stream ticks). */
const unreadBadgeCounted = new Set<number>();

function onEvent(e: any): void {
  if (e.type === "message" || e.type === "message_update") {
    const msg = e.message as Message;
    if (!msg?.channel_id) return;
    if (msg.photon_conversation_id) {
      if (S.view === "texts") renderChannelView();
      return;
    }
    const mine = msg.author?.kind === "user" && msg.author.id === S.me.id;
    const mentionsMe = new RegExp(`@${S.me.username}\\b`, "i").test(msg.body || "");
    // Only "viewing" a channel when its chat surface is open — not while sitting in global Threads.
    const viewingThisChannel = !S.globalThreadsOpen && msg.channel_id === S.channelId;
    if (viewingThisChannel) {
      applyMessage(msg, e.type === "message_update", e.parent as Message | undefined);
      // Advance last_read only for settled activity so in-flight Working never eats the final turn.
      if (messageIsSettled(msg) || (e.type === "message" && msg.author?.kind === "user")) {
        markChannelRead(msg.channel_id);
        unreadBadgeCounted.add(msg.id);
      }
      if (e.type === "message" && !mine) playNotification(msg.channel_id, mentionsMe ? "mention" : "msg");
      // Stream ticks mutate one or two message rows. Rebuilding the whole thread
      // panel here used to destroy the focused composer every 75 ms while an
      // agent was working, which also reset selection and made scrolling jump.
      paintLiveMessage(msg);
    } else if (!mine && messageIsSettled(msg)) {
      // Finished agent reply (or human message) while you're elsewhere → white name badge.
      // Count each message id once — stream ticks reuse the same Working… row.
      if (!unreadBadgeCounted.has(msg.id)) {
        unreadBadgeCounted.add(msg.id);
        bumpChannelUnread(msg.channel_id);
        playNotification(msg.channel_id, mentionsMe ? "mention" : "msg");
      }
    } else if (e.type === "message" && !mine && !messageIsSettled(msg)) {
      // Working… started in another channel — amber dots come from agent_status; no badge yet.
      playNotification(msg.channel_id, mentionsMe ? "mention" : "msg");
    }
  } else if (e.type === "photon_update") {
    S.photonConfigured = true;
    if (e.conversationId) S.selectedTextConversationId = Number(e.conversationId);
    if (S.view === "texts") renderChannelView(); else renderHeader();
  } else if (e.type === "message_deleted") {
    applyMessageDeleted(e);
  } else if (e.type === "mention_confirmation") {
    mentionConfirmation(e);
  } else if (e.type === "member_add_confirmation") {
    memberAddConfirmation(e);
  } else if (e.type === "bot_prompt") botPrompt(e);
  else if (e.type === "channel_new") {
    if (e.channel?.id) mergeChannelMeta(e.channel);
    void loadWorkspace().then(() => {
      renderSidebar();
      if (e.channel?.id === S.channelId) renderHeader();
    });
  }
  else if (e.type === "channel_update") {
    if (e.channel?.id) mergeChannelMeta(e.channel);
    renderSidebar();
    if (e.channel?.id === S.channelId) {
      // Avatar / agent runtime changes land here — refresh chat faces without a full reload.
      const runtime = e.channel?.agent?.runtime;
      if (runtime?.id) {
        const applyBot = (list: Bot[] | undefined): Bot[] | undefined => {
          if (!list) return list;
          return list.map((bot) => bot.id === runtime.id ? { ...bot, ...runtime } : bot);
        };
        S.bots = applyBot(S.bots) || S.bots;
        S.channelBots = applyBot(S.channelBots) || S.channelBots;
      }
      // Keep the URL slug in sync after rename without a hard navigation.
      writeRoute(S.channels.find((c) => c.id === S.channelId), S.view, S.threadRoot?.id ?? null, true);
      renderHeader();
      if (S.view === "settings") renderChannelView();
      else if (S.view === "chat") { renderMessages(); if (S.threadRoot) renderThread(); }
    }
  } else if (e.type === "channel_deleted") {
    S.channels = S.channels.filter((channel) => channel.id !== e.channelId);
    if (S.channelId === e.channelId) {
      S.channelId = S.channels.find((channel) => channel.name === "main" && channel.kind === "channel")?.id || S.channels[0]?.id || 0;
      S.view = "chat"; if (S.channelId) void openChannel(S.channelId); else renderApp();
    } else renderSidebar();
  } else if (e.type === "agent_status") {
    const channel = S.channels.find((item) => item.id === e.channelId);
    if (channel?.agent) channel.agent.status = e.status;
    // Sidebar shows bouncing working dots on every channel row — always refresh.
    renderSidebar();
    if (e.channelId === S.channelId) renderHeader();
  } else if (e.type === "activity" || e.type === "escalation") {
    if (e.channelId === S.channelId && (S.view === "activity" || S.view === "memory")) renderChannelView();
  } else if (e.type === "thread_update") {
    // Skipper (or API) changed durable session status — refresh board/threads/activity surfaces.
    if (S.globalThreadsOpen) renderMain();
    else if (Number(e.channelId) === Number(S.channelId) && (S.view === "board" || S.view === "threads" || S.view === "activity")) {
      renderChannelView();
    }
  } else if (e.type === "followup") {
    // Durable agent wake scheduled/cleared — Board and the open thread share this source.
    if (Number(e.channelId) === Number(S.channelId) && (S.view === "board" || S.view === "threads")) {
      renderChannelView();
    }
    if (Number(e.channelId) === Number(S.channelId) && S.threadRoot && Number(e.rootMessageId) === Number(S.threadRoot.id)) {
      S.threadFollowup = e.followup || null;
      paintThreadFollowup();
    }
  } else if (e.type === "channel_bots") { if (S.channelBots) { S.channelBots = e.bots; renderHeader(); } }
  else if (e.type === "thread_usage") {
    if (Number(e.channelId) !== Number(S.channelId)) return;
    if (!S.threadRoot || Number(e.rootMessageId) !== Number(S.threadRoot.id)) return;
    S.threadUsage = {
      input_tokens: Math.max(0, Number(e.input_tokens || 0)),
      output_tokens: Math.max(0, Number(e.output_tokens || 0)),
    };
    // Surgical DOM update — no full thread rebuild (keeps scroll / work-log open state).
    paintThreadCtx();
  } else if (e.type === "workspace_update" && e.workspace) {
    S.workspace = e.workspace;
    document.documentElement.dataset.workspaceTheme = S.workspace.theme || "graphite";
    localStorage.setItem("ctrl.workspaceTheme", S.workspace.theme || "graphite");
    renderSidebar();
    renderHeader();
  } else if (e.type === "routing_activity") {
    pushRoutingActivity(e.activity);
  } else if (e.type === "provider_update" && e.provider) {
    const i = S.providers.findIndex((p) => p.id === e.provider.id);
    if (i >= 0) S.providers[i] = e.provider; else S.providers = [...S.providers, e.provider];
    if (S.view === "settings") renderChannelView();
  } else if (e.type === "provider_deleted") {
    S.providers = S.providers.filter((p) => p.id !== e.providerId);
    if (S.view === "settings") renderChannelView();
  } else if (e.type === "providers_changed") {
    void reloadProviders().then(() => { if (S.view === "settings") renderChannelView(); });
  } else if (e.type === "skills_changed") {
    void loadWorkspace().then(() => {
      renderSidebar();
      renderHeader();
      if (S.view === "settings") renderChannelView();
      refreshOpenSkillsSettings();
    });
  } else if (e.type === "bot_update" && e.bot) {
    const i = S.bots.findIndex((b) => b.id === e.bot.id);
    if (i >= 0) S.bots[i] = e.bot; else S.bots = [...S.bots, e.bot];
    S.channelBots = S.channelBots.map((b) => b.id === e.bot.id ? e.bot : b);
    if (S.channelId) renderHeader();
  } else if (e.type === "bot_deleted") {
    S.bots = S.bots.filter((b) => b.id !== e.botId);
    S.channelBots = S.channelBots.filter((b) => b.id !== e.botId);
  } else if (e.type === "computer_update" && e.computer) {
    const i = S.computers.findIndex((c) => c.id === e.computer.id);
    if (i >= 0) S.computers[i] = e.computer; else S.computers = [...S.computers, e.computer];
  } else if (e.type === "computer_deleted") {
    S.computers = S.computers.filter((c) => c.id !== e.computerId);
  } else if (e.type === "user_update" && e.user) {
    const i = S.users.findIndex((u) => u.id === e.user.id);
    if (i >= 0) S.users[i] = e.user; else S.users = [...S.users, e.user];
    if (e.user.id === S.me.id) { S.me = { ...S.me, ...e.user }; renderSidebar(); }
  } else if (e.type === "user_deleted") {
    S.users = S.users.filter((u) => u.id !== e.userId);
  }
}

function applyMessage(msg: Message, isUpdate: boolean, authoritativeParent?: Message): void {
  const list = msg.parent_id == null ? S.messages : (S.threadRoot && msg.parent_id === S.threadRoot.id ? S.threadReplies : null);
  const i = list?.findIndex((m) => m.id === msg.id) ?? -1;
  if (msg.parent_id != null) {
    const parent = S.messages.find((m) => m.id === msg.parent_id);
    if (parent && authoritativeParent) {
      parent.reply_count = authoritativeParent.reply_count;
      parent.last_reply = authoritativeParent.last_reply;
    } else if (parent && !isUpdate && i < 0 && msg.body && msg.body !== "_Working…_") parent.reply_count++;
    // Surface agent Working on the channel root without opening the thread.
    // Prefer real thought/tool progress from the reply so the root chip stays sticky
    // with the latest statement instead of a synthetic "Working…".
    if (parent && messageIsWorking(msg)) {
      if (msg.progress?.length) {
        parent.progress = msg.progress;
      } else {
        parent.progress = parent.progress?.length ? parent.progress : [{ id: -1, kind: "status", body: "Working…", status: "running", created: Date.now(), updated: Date.now() } as any];
        if (!parent.progress.some((p) => p.status === "running")) {
          parent.progress = [...parent.progress, { id: -1, kind: "status", body: "Working…", status: "running", created: Date.now(), updated: Date.now() } as any];
        }
      }
    }
    if (parent && isUpdate && !messageIsWorking(msg) && parent.progress) {
      // Drop synthetic root markers; prefer the finished reply's progress snapshot.
      parent.progress = msg.progress?.length ? msg.progress : parent.progress.filter((p) => p.id !== -1);
    }
    if (S.threadRoot?.id === msg.parent_id && authoritativeParent) {
      S.threadRoot.reply_count = authoritativeParent.reply_count;
      S.threadRoot.last_reply = authoritativeParent.last_reply;
    }
  }
  if (!list) {
    // Thread reply while thread pane closed: still mark root working for channel chip.
    if (msg.parent_id != null) {
      const parent = S.messages.find((m) => m.id === msg.parent_id);
      if (parent && messageIsWorking(msg)) {
        if (msg.progress?.length) parent.progress = msg.progress;
        else if (!parent.progress?.some((p) => p.status === "running")) {
          parent.progress = [...(parent.progress || []), { id: -1, kind: "status", body: "Working…", status: "running", created: Date.now(), updated: Date.now() } as any];
        }
      }
    }
    return;
  }
  if (i >= 0) list[i] = msg; else list.push(msg);
  if (msg.parent_id == null && S.threadRoot?.id === msg.id) S.threadRoot = msg;
}

function applyMessageDeleted(e: {
  channelId: number;
  messageId: number;
  parentId: number | null;
  deletedIds?: number[];
  parent?: { id: number; reply_count: number; last_reply: number | null };
}): void {
  // Coerce: JSON/WS and HTTP can deliver string ids depending on path.
  const channelId = Number(e.channelId);
  if (channelId !== Number(S.channelId)) return;
  const deleted = new Set((e.deletedIds && e.deletedIds.length ? e.deletedIds : [e.messageId]).map(Number));
  const before = S.messages.length + S.threadReplies.length;
  S.messages = S.messages.filter((m) => !deleted.has(Number(m.id)));
  S.threadReplies = S.threadReplies.filter((m) => !deleted.has(Number(m.id)));
  if (e.parent) {
    const parentId = Number(e.parent.id);
    const parent = S.messages.find((m) => Number(m.id) === parentId);
    if (parent) {
      parent.reply_count = Number(e.parent.reply_count);
      parent.last_reply = e.parent.last_reply == null ? null : Number(e.parent.last_reply);
    }
    if (S.threadRoot && Number(S.threadRoot.id) === parentId) {
      S.threadRoot.reply_count = Number(e.parent.reply_count);
      S.threadRoot.last_reply = e.parent.last_reply == null ? null : Number(e.parent.last_reply);
    }
  }
  if (S.threadRoot && deleted.has(Number(S.threadRoot.id))) {
    S.threadRoot = null;
    S.threadReplies = [];
    renderMain();
    return;
  }
  // Skip re-render if both HTTP optimistic path and WS already cleaned state.
  if (before === S.messages.length + S.threadReplies.length && !e.parent) return;
  renderMessages();
  if (S.threadRoot) renderThread();
}

// ---------------- auth ----------------
function renderAuth(): void {
  clear(root);
  const err = h("p", { class: "min-h-5 text-sm text-danger" });
  const u = h("input", { class: "field", placeholder: "username", autocomplete: "username" });
  const pw = h("input", { class: "field", type: "password", placeholder: "password", autocomplete: "current-password" });
  const submit = async (): Promise<void> => {
    err.textContent = "";
    try { const r = await api<{ token: string; user: User }>("/api/auth/login", { body: { username: u.value, password: pw.value } }); setToken(r.token); boot(); }
    catch (e) { err.textContent = (e as Error).message; }
  };
  const access = h("div", { class: "space-y-3" });
  root.append(h("div", { class: "auth-stage grid h-full place-items-center overflow-y-auto p-6" },
    h("div", { class: "w-full max-w-[380px]" },
      h("div", { class: "mb-10 flex flex-col items-center text-center" },
        h("div", { class: "logo-plate h-14 w-14 rounded-lg" }, h("img", { class: "logo-asset", src: "/brand/1helm-sailboat.png", alt: "1Helm" })),
        h("h1", { class: "mt-5 text-[2rem] font-bold leading-none tracking-[-0.03em] text-fg" }, "1Helm"),
        h("p", { class: "eyebrow mt-3 text-muted" }, "Native agent workspace")),
      h("div", { class: "card space-y-3 p-7" },
        h("div", { class: "mb-3" }, h("h2", { class: "font-display text-[1.55rem] leading-tight text-fg" }, "Enter the bridge"), h("p", { class: "mt-1.5 text-sm text-muted" }, "Sign in to your workspace.")),
        u, pw, err,
        h("button", { class: "btn-primary w-full py-2.5", onclick: submit }, "Sign in"), access))));
  pw.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Enter") submit(); });
  u.focus();
  void renderAccessRequest(access);
}

async function renderAccessRequest(container: HTMLElement): Promise<void> {
  const key = `1helm.access-request.${location.host}`;
  const claimToken = localStorage.getItem(key) || "";
  let workspace: { name: string; collaboration_enabled: boolean; accept_new_requests: boolean };
  try { workspace = (await api<{ workspace: typeof workspace }>("/api/collaboration/public")).workspace; }
  catch { return; }
  if (!workspace.collaboration_enabled) return;
  clear(container);
  if (claimToken) {
    try {
      const { request } = await api<{ request: { email: string; display: string; status: string } }>(`/api/access-requests/${claimToken}`);
      if (request.status === "pending") {
        container.append(h("div", { class: "border-t border-line pt-3 text-center" }, h("p", { class: "text-sm font-semibold text-fg" }, "Access requested"), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, `The Captain will review ${request.email} in Settings → Members.`), h("button", { class: "btn-ghost mt-2 text-xs", onclick: () => { void renderAccessRequest(container); } }, "Check again")));
        return;
      }
      if (request.status === "denied") {
        localStorage.removeItem(key);
        container.append(h("p", { class: "border-t border-line pt-3 text-center text-xs text-danger" }, "This access request was not approved."));
        return;
      }
      if (request.status === "approved") {
        const display = h("input", { class: "field", value: request.display || "", placeholder: "Your name", autocomplete: "name" }) as HTMLInputElement;
        const username = h("input", { class: "field", placeholder: "Choose a username", autocomplete: "username" }) as HTMLInputElement;
        const password = h("input", { class: "field", type: "password", placeholder: "Password (8+ characters)", autocomplete: "new-password" }) as HTMLInputElement;
        const status = h("p", { class: "min-h-5 text-xs text-danger" });
        const finish = async (): Promise<void> => {
          try {
            const result = await api<{ token: string }>(`/api/access-requests/${claimToken}`, { body: { display: display.value, username: username.value, password: password.value } });
            localStorage.removeItem(key); setToken(result.token); void boot();
          } catch (error) { status.textContent = (error as Error).message; }
        };
        container.append(h("div", { class: "space-y-2 border-t border-line pt-3" }, h("p", { class: "text-sm font-semibold text-fg" }, "You’re approved"), h("p", { class: "text-xs text-muted" }, "Create your local account for this workspace."), display, username, password, status, h("button", { class: "btn-primary w-full", onclick: () => { void finish(); } }, "Create account and sign in")));
        return;
      }
      if (request.status === "claimed") localStorage.removeItem(key);
    } catch { localStorage.removeItem(key); }
  }
  const open = (): void => {
    clear(container);
    const email = h("input", { class: "field", type: "email", placeholder: "you@company.com", autocomplete: "email" }) as HTMLInputElement;
    const display = h("input", { class: "field", placeholder: "Your name", autocomplete: "name" }) as HTMLInputElement;
    const status = h("p", { class: "min-h-5 text-xs text-danger" });
    container.append(h("div", { class: "space-y-2 border-t border-line pt-3" }, h("p", { class: "text-sm font-semibold text-fg" }, `Request access to ${workspace.name}`), display, email, status,
      h("button", { class: "btn-primary w-full", onclick: async () => {
        try {
          const result = await api<{ claim_token: string }>("/api/access-requests", { body: { email: email.value, display: display.value } });
          localStorage.setItem(key, result.claim_token); await renderAccessRequest(container);
        } catch (error) { status.textContent = (error as Error).message; }
      } }, "Send request"), h("button", { class: "btn-ghost w-full text-xs", onclick: () => { void renderAccessRequest(container); } }, "Back to sign in")));
    display.focus();
  };
  container.append(h("div", { class: "border-t border-line pt-3 text-center" }, h("button", { class: "btn-ghost text-sm", onclick: open }, "Request access")));
}

// ---------------- layout ----------------
export function renderApp(): void {
  const focusedNote = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.classList.contains("note-editor")
    ? { node: document.activeElement, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null;
  document.documentElement.dataset.workspaceTheme = S.workspace?.theme || localStorage.getItem("ctrl.workspaceTheme") || "graphite";
  clear(root);
  const shell = h("div", { id: "app-shell", class: "workspace-shell app-shell relative flex h-full min-h-0 min-w-0 overflow-hidden" },
    sidebar(),
    h("main", { id: "main", class: "relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-bg" }));
  root.append(shell);
  if (S.mobileMenuOpen) shell.append(mobileNavigation());
  renderMain();
  if (focusedNote?.node.isConnected) {
    focusedNote.node.focus({ preventScroll: true });
    focusedNote.node.setSelectionRange(focusedNote.start, focusedNote.end);
  }
}

function setMobileMenu(open: boolean): void {
  S.mobileMenuOpen = open;
  document.getElementById("mobile-navigation")?.remove();
  document.querySelectorAll<HTMLElement>("[data-mobile-menu-button]").forEach((button) => button.setAttribute("aria-expanded", String(open)));
  if (!open) return;
  const shell = document.getElementById("app-shell");
  if (!shell) return;
  shell.append(mobileNavigation());
  requestAnimationFrame(() => document.querySelector<HTMLElement>("#mobile-navigation [data-drawer-close]")?.focus());
}

function closeMobileMenu(): void { setMobileMenu(false); }

export function mobileMenuButton(): HTMLButtonElement {
  return h("button", {
    class: "mobile-menu-button grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-fg md:hidden",
    title: "Open navigation", "aria-label": "Open navigation", "aria-expanded": String(Boolean(S.mobileMenuOpen)),
    "aria-controls": "mobile-navigation", dataset: { mobileMenuButton: "" }, onclick: () => setMobileMenu(true),
  }, icon("menu", 22));
}

function mobileNavigation(): HTMLElement {
  return h("div", { id: "mobile-navigation", class: "fixed inset-0 z-40 md:hidden" },
    h("button", { class: "absolute inset-0 bg-black/60 backdrop-blur-[2px]", "aria-label": "Close navigation", onclick: closeMobileMenu }),
    sidebar(true));
}

function sidebar(drawer = false): HTMLElement {
  const chan = (c: Channel): HTMLElement => {
    const active = c.id === S.channelId && !S.globalThreadsOpen;
    const unread = Number(c.unread) > 0;
    const working = c.agent?.status === "working";
    const labels = [c.name, working ? "working" : "", unread ? "unread" : ""].filter(Boolean);
    // Name carries the iOS-style unread badge on its upper-right corner (on the text, not the row end).
    const name = h("span", { class: "channel-nav-label min-w-0 flex-1" },
      h("span", { class: "channel-nav-name truncate" }, c.name),
      unread && h("span", { class: "channel-unread-badge", "aria-hidden": "true" }),
    );
    return h("button", {
      class: `nav-item ${active ? "nav-item-active" : "nav-item-idle"} ${unread || working ? "font-semibold text-white" : ""}`,
      title: labels.join(" · "),
      "aria-label": labels.join(", "),
      onclick: () => { closeMobileMenu(); void openChannel(c.id); },
    },
      c.kind === "dm"
        ? h("span", { class: "relative grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-white/10 text-[9px] font-semibold", style: `background:${color(c.name)};color:#f4f7fb` }, initials(c.name))
        : h("span", { class: "shrink-0 text-sidebar-muted" }, icon("hash", 14)),
      name,
      // Live agent turn — three bouncing dots after the name.
      working && h("span", {
        class: "channel-working-dots shrink-0",
        title: "Agent working",
        "aria-hidden": "true",
      }, h("span"), h("span"), h("span")));
  };
  const allChannels = S.channels.filter((c) => c.kind === "channel" && c.status !== "archived");
  const archived = S.channels.filter((c) => c.kind === "channel" && c.status === "archived");
  const allHuman = S.channels.filter((c) => ["collab", "human"].includes(c.kind) && c.status !== "archived");
  const allDms = S.channels.filter((c) => c.kind === "dm" && c.status !== "archived");
  const favorites = S.channels.filter((c) => c.status !== "archived" && c.favorite);
  const favoriteIds = new Set(favorites.map((c) => c.id));
  const unreads = S.groupUnreadChannelsFirst
    ? S.channels.filter((c) => c.status !== "archived" && Number(c.unread) > 0 && !favoriteIds.has(c.id))
    : [];
  const groupedUnreadIds = new Set([...favorites, ...unreads].map((c) => c.id));
  const channels = allChannels.filter((c) => !groupedUnreadIds.has(c.id));
  const human = allHuman.filter((c) => !groupedUnreadIds.has(c.id));
  const dms = allDms.filter((c) => !groupedUnreadIds.has(c.id));
  const theme = currentTheme();

  return h("aside", {
    class: drawer
      ? "mobile-drawer fixed inset-y-0 left-0 z-10 flex w-[min(86vw,320px)] flex-col border-r border-white/5 bg-sidebar text-sidebar-fg shadow-2xl"
      : "workspace-sidebar hidden w-64 shrink-0 flex-col border-r border-white/5 bg-sidebar text-sidebar-fg md:flex",
    dataset: { sidebar: drawer ? "mobile" : "desktop" }, role: drawer ? "dialog" : undefined,
    "aria-modal": drawer ? "true" : undefined, "aria-label": drawer ? "Workspace navigation" : undefined,
  },
    h("div", { class: "flex items-center justify-between border-b border-white/10 px-4 py-3.5" },
      h("div", { class: "flex min-w-0 flex-1 items-start gap-2.5 pr-1 font-semibold text-white" }, h("span", { class: `logo-plate h-7 w-7 shrink-0 rounded-md${S.workspace?.photo_url ? " logo-plate-photo" : ""}` }, h("img", { class: `logo-asset${S.workspace?.photo_url ? " logo-asset-fill" : ""}`, src: workspacePhotoSrc(S.workspace?.photo_url, "sidebar"), alt: S.workspace?.name || "1Helm" })), h("span", { class: "min-w-0 whitespace-normal break-words text-[15px] leading-5 tracking-[-0.01em]", dataset: { workspaceName: "" } }, S.workspace?.name || "1Helm")),
      h("div", { class: "flex items-center gap-1" },
        h("button", { class: "grid h-9 w-9 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-white", title: theme === "light" ? "Switch to dark" : "Switch to light", onclick: toggleTheme }, icon(theme === "light" ? "moon" : "sun")),
        drawer ? h("button", { class: "grid h-11 w-11 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-white", title: "Close navigation", "aria-label": "Close navigation", dataset: { drawerClose: "" }, onclick: closeMobileMenu }, icon("x", 20)) : null)),
    h("div", { class: "flex-1 space-y-5 overflow-y-auto px-2 py-3" },
      allChannels.length ? h("div", { class: "px-1 pb-1" },
        h("button", {
          type: "button",
          class: `nav-item w-full ${S.globalThreadsOpen ? "nav-item-active" : "nav-item-idle"}`,
          title: "All threads across agent channels",
          "aria-pressed": String(Boolean(S.globalThreadsOpen)),
          onclick: () => { closeMobileMenu(); openGlobalThreads(); },
        },
          h("span", { class: "shrink-0 text-sidebar-muted" }, icon("thread", 14)),
          h("span", { class: "flex-1 truncate text-left" }, "Threads"))) : null,
      favorites.length ? h("div", { dataset: { sidebarFavorites: "" } }, h("div", { class: "eyebrow px-2 pb-1 text-sidebar-muted" }, "Favorites"), h("div", { class: "space-y-px" }, ...favorites.map(chan))) : null,
      unreads.length ? h("div", { dataset: { sidebarUnreads: "" } }, h("div", { class: "eyebrow px-2 pb-1 text-sidebar-muted" }, "Unreads"), h("div", { class: "space-y-px" }, ...unreads.map(chan))) : null,
      channels.length || S.me.is_admin ? h("div", {}, sbSection("Agent channels", () => newChannel()), h("div", { class: "space-y-px" }, ...channels.map(chan))) : null,
      archived.length ? h("div", {}, h("div", { class: "eyebrow px-2 pb-1 text-sidebar-muted" }, "Archived"), h("div", { class: "space-y-px opacity-65" }, ...archived.map(chan))) : null,
      h("div", {}, sbSection("Human channels", () => newHumanChannel()), h("div", { class: "space-y-px" }, ...human.map(chan), human.length === 0 && h("p", { class: "px-2 py-1 text-[13px] text-sidebar-muted" }, "No human channels yet"))),
      h("div", {}, sbSection("Direct messages", () => newDM()), h("div", { class: "space-y-px" }, ...dms.map(chan), dms.length === 0 && h("p", { class: "px-2 py-1 text-[13px] text-sidebar-muted" }, "No conversations yet")))),
    h("button", {
      class: "mx-2 mb-1 flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-muted hover:bg-sidebar-hover hover:text-white",
      type: "button",
      dataset: { feedbackAction: "" },
      onclick: () => { closeMobileMenu(); openFeedback(); },
    }, icon("chat", 14), "Feedback"),
    h("div", { class: "flex items-center gap-1 border-t border-white/10 p-1.5" },
      h("button", { class: "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sidebar-hover", title: "Open profile", onclick: (event: MouseEvent) => { closeMobileMenu(); openProfile(event.currentTarget as HTMLElement); } },
        avatar(S.me.display, "user", 8, S.me.avatar),
        h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate text-sm font-semibold text-white" }, S.me.display), h("div", { class: "flex items-center gap-1.5 truncate font-mono text-[10.5px] text-sidebar-muted" }, h("span", { class: "h-1.5 w-1.5 rounded-full bg-ok" }), "@" + S.me.username + (S.me.is_admin ? " · admin" : "")))),
      h("button", { class: "grid h-10 w-10 shrink-0 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-white", title: S.me.is_admin ? "Settings" : "Provider settings", "aria-label": "Open settings", onclick: () => { closeMobileMenu(); openSettings(S.me.is_admin ? "agents" : "providers"); } }, icon("gear"))));
}

function openFeedback(): void {
  document.getElementById("feedback-modal")?.remove();
  const overlay = h("div", {
    id: "feedback-modal",
    class: "modal-overlay fixed inset-0 z-[90] grid place-items-center bg-black/70 p-3",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Send feedback",
  });
  const comment = h("textarea", {
    class: "field min-h-36 resize-y",
    maxlength: 10000,
    placeholder: "What happened? What did you expect?",
    dataset: { feedbackComment: "" },
  }) as HTMLTextAreaElement;
  const picker = h("input", {
    type: "file",
    multiple: true,
    class: "hidden",
    accept: "image/*,application/pdf,text/plain,application/json",
    dataset: { feedbackFiles: "" },
  }) as HTMLInputElement;
  const fileList = h("div", { class: "space-y-1 text-xs text-muted" });
  const diagnostics = h("input", {
    type: "checkbox",
    checked: false,
    class: "accent-accent",
    dataset: { feedbackDiagnostics: "" },
  }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted", dataset: { feedbackStatus: "" } });
  let files: File[] = [];
  const showFiles = (): void => {
    clear(fileList);
    fileList.append(...files.map((file) => h("div", { class: "truncate" }, `${file.name} · ${Math.ceil(file.size / 1024)} KB`)));
  };
  picker.onchange = () => {
    const selected = [...(picker.files || [])].slice(0, 3);
    if (selected.some((file) => file.size > 5 * 1024 * 1024) || selected.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) {
      status.textContent = "Attachments are limited to 5 MB each and 10 MB total.";
      return;
    }
    files = selected;
    status.textContent = "";
    showFiles();
  };
  const close = (): void => overlay.remove();
  const submit = h("button", {
    class: "btn-primary text-sm",
    type: "button",
    dataset: { feedbackSubmit: "" },
    onclick: async () => {
      submit.disabled = true;
      status.textContent = "Saving feedback…";
      try {
        const uploads = [];
        for (const file of files) uploads.push(await uploadFile(file));
        const result = await api<{ feedback: { id: string; state: string } }>("/api/feedback", {
          body: { comment: comment.value, send_diagnostics: diagnostics.checked, uploads },
        });
        status.textContent = `Saved as ${result.feedback.id}. Delivery will retry automatically if this host is offline.`;
        setTimeout(close, 1400);
      } catch (error) {
        status.textContent = (error as Error).message;
        submit.disabled = false;
      }
    },
  }, "Send feedback") as HTMLButtonElement;
  const card = h("section", { class: "card w-full max-w-xl space-y-4 p-5 shadow-2xl" },
    h("div", { class: "flex items-start justify-between gap-3" },
      h("div", {},
        h("h2", { class: "font-display text-xl text-fg" }, "Send feedback"),
        h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Tell us what feels broken or what would make 1Helm better."),
        h("p", { class: "mt-1 text-xs leading-5 text-muted" }, "You can also email ", h("a", {
          class: "text-accent hover:underline",
          href: "mailto:build@1helm.com",
          target: "_blank",
          rel: "noopener",
        }, "build@1helm.com"), ".")),
      h("button", { class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close feedback", onclick: close }, icon("x"))),
    comment,
    h("div", {},
      h("button", { class: "btn-subtle text-sm", type: "button", onclick: () => picker.click() }, "Add attachments"),
      picker,
      fileList),
    h("label", { class: "flex items-start gap-2 rounded-lg border border-line bg-panel p-3 text-sm text-fg" },
      diagnostics,
      h("span", {}, "Include privacy-bounded diagnostics",
        h("span", { class: "mt-1 block text-xs leading-5 text-muted" }, "Optional. Includes app version, platform, runtime health, failed capability names/statuses, and connector health. Never includes chats, prompts, account content, terminal output, tokens, keys, or OAuth data."))),
    status,
    h("div", { class: "flex justify-end gap-2" },
      h("button", { class: "btn-subtle text-sm", onclick: close }, "Cancel"),
      submit));
  overlay.onclick = (event) => { if (event.target === overlay) close(); };
  overlay.append(card);
  document.body.append(overlay);
  comment.focus();
}

function openProfile(anchor: HTMLElement): void {
  document.getElementById("profile-popover")?.remove();
  const display = h("input", { class: "field", value: S.me.display, maxlength: 100 }) as HTMLInputElement;
  const jobTitle = h("input", { class: "field", value: S.me.job_title || "", placeholder: "Job title", maxlength: 160 }) as HTMLInputElement;
  const description = h("textarea", { class: "field min-h-24 resize-y", placeholder: "A little about you and how you work", maxlength: 1000 }, S.me.description || "") as HTMLTextAreaElement;
  description.value = S.me.description || "";
  const photoSlot = h("div", { class: "shrink-0" }, avatar(S.me.display, "user", 20, S.me.avatar));
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", class: "hidden" }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-xs text-muted" });
  const cropCanvas = h("canvas", { width: 320, height: 320, class: "aspect-square h-auto w-full cursor-move touch-none rounded-xl bg-raised object-cover", "aria-label": "Move photo crop" }) as HTMLCanvasElement;
  const cropZoom = h("input", { type: "range", min: "1", max: "3", step: "0.01", value: "1", class: "w-full accent-accent", "aria-label": "Photo zoom" }) as HTMLInputElement;
  const cropPanel = h("div", { class: "hidden space-y-2 rounded-xl border border-line bg-panel p-3", dataset: { profilePhotoCrop: "" } },
    h("div", { class: "mx-auto w-full max-w-72 overflow-hidden rounded-xl" }, cropCanvas),
    h("label", { class: "flex items-center gap-3 text-xs font-semibold text-fg" }, "Zoom", cropZoom),
    h("p", { class: "text-center text-[11px] leading-4 text-muted" }, "Drag to move the photo inside the square. The compressed square preview uploads only when you save."));
  let crop: { image: HTMLImageElement; url: string; zoom: number; x: number; y: number } | null = null;
  let drag: { pointerId: number; x: number; y: number; startX: number; startY: number } | null = null;
  const cropBounds = (): { scale: number; minX: number; minY: number } | null => {
    if (!crop) return null;
    const scale = Math.max(cropCanvas.width / crop.image.naturalWidth, cropCanvas.height / crop.image.naturalHeight) * crop.zoom;
    return { scale, minX: cropCanvas.width - crop.image.naturalWidth * scale, minY: cropCanvas.height - crop.image.naturalHeight * scale };
  };
  const clampCrop = (): void => {
    const bounds = cropBounds(); if (!crop || !bounds) return;
    crop.x = Math.min(0, Math.max(bounds.minX, crop.x));
    crop.y = Math.min(0, Math.max(bounds.minY, crop.y));
  };
  const paintCrop = (): void => {
    const ctx = cropCanvas.getContext("2d"); const bounds = cropBounds();
    if (!ctx || !crop || !bounds) return;
    clampCrop(); ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.drawImage(crop.image, crop.x, crop.y, crop.image.naturalWidth * bounds.scale, crop.image.naturalHeight * bounds.scale);
  };
  const centerCrop = (): void => {
    const bounds = cropBounds(); if (!crop || !bounds) return;
    crop.x = bounds.minX / 2; crop.y = bounds.minY / 2; paintCrop();
  };
  cropZoom.oninput = () => {
    if (!crop) return;
    const oldBounds = cropBounds(); if (!oldBounds) return;
    const centerX = (cropCanvas.width / 2 - crop.x) / oldBounds.scale;
    const centerY = (cropCanvas.height / 2 - crop.y) / oldBounds.scale;
    crop.zoom = Number(cropZoom.value);
    const nextBounds = cropBounds(); if (!nextBounds) return;
    crop.x = cropCanvas.width / 2 - centerX * nextBounds.scale;
    crop.y = cropCanvas.height / 2 - centerY * nextBounds.scale;
    paintCrop();
  };
  cropCanvas.onpointerdown = (event) => {
    if (!crop) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: crop.x, startY: crop.y };
    cropCanvas.setPointerCapture(event.pointerId);
  };
  cropCanvas.onpointermove = (event) => {
    if (!crop || !drag || drag.pointerId !== event.pointerId) return;
    const ratio = cropCanvas.width / cropCanvas.getBoundingClientRect().width;
    crop.x = drag.startX + (event.clientX - drag.x) * ratio;
    crop.y = drag.startY + (event.clientY - drag.y) * ratio;
    paintCrop();
  };
  cropCanvas.onpointerup = cropCanvas.onpointercancel = (event) => {
    if (drag?.pointerId === event.pointerId) drag = null;
  };
  const renderedPhoto = async (): Promise<Blob | null> => {
    if (!crop) return null;
    const output = document.createElement("canvas"); output.width = 512; output.height = 512;
    const ctx = output.getContext("2d"); const bounds = cropBounds(); if (!ctx || !bounds) return null;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 512, 512);
    const ratio = output.width / cropCanvas.width;
    ctx.drawImage(crop.image, crop.x * ratio, crop.y * ratio, crop.image.naturalWidth * bounds.scale * ratio, crop.image.naturalHeight * bounds.scale * ratio);
    return new Promise((resolve) => output.toBlob(resolve, "image/jpeg", 0.86));
  };
  const updateStatus = h("p", { class: "mt-1 min-h-4 text-xs leading-5 text-muted", dataset: { profileUpdateStatus: "" } });
  const updateLabel = h("p", { class: "font-mono text-[10px] leading-4 text-faint" }, "1Helm");
  const updateButton = h("button", {
    class: "btn-subtle min-h-9 shrink-0 px-3 text-xs",
    dataset: { profileUpdateAction: "" },
  }, "Check for updates") as HTMLButtonElement;
  type HostUpdate = { mode: "native-macos" | "native-windows" | "linux-systemd" | "source"; status: string; current_version: string; version: string | null; message: string; error: string | null };
  let updatePoll = 0;
  const applyUpdate = (update: HostUpdate): void => {
    const version = update.version ? ` · v${update.version}` : "";
    updateLabel.textContent = `1Helm v${update.current_version}${version}`;
    updateStatus.textContent = update.error || update.message;
    updateButton.className = "btn-subtle min-h-9 shrink-0 px-3 text-xs";
    updateButton.disabled = false;
    delete updateButton.dataset.updateUrl;
    if (update.status === "available") {
      updateButton.className = "btn-primary min-h-9 shrink-0 px-3 text-xs";
      updateButton.textContent = update.mode === "linux-systemd" ? `Update host to v${update.version}` : `Download on host`;
      updateButton.onclick = () => { void runUpdateAction("download"); };
    } else if (update.status === "ready") {
      updateButton.className = "btn-primary min-h-9 shrink-0 px-3 text-xs";
      updateButton.textContent = "Restart & install";
      updateButton.onclick = () => { void runUpdateAction("install"); };
    } else if (["queued", "checking", "downloading", "installing", "restarting"].includes(update.status)) {
      updateButton.disabled = true;
      updateButton.textContent = update.status === "queued" ? "Queued on host…" : update.status === "downloading" ? "Downloading on host…" : update.status === "installing" || update.status === "restarting" ? "Restarting host…" : "Checking host…";
      window.clearTimeout(updatePoll);
      updatePoll = window.setTimeout(() => { void checkForUpdates(); }, 1_000);
    } else if (update.status === "managed" || update.status === "unsupported") {
      updateButton.disabled = true;
      updateButton.textContent = "Host-managed";
    } else {
      updateButton.textContent = update.status === "current" ? "Check again" : "Check host";
      updateButton.onclick = () => { void runUpdateAction("download"); };
    }
  };
  const checkForUpdates = async (): Promise<void> => {
    updateButton.disabled = true;
    updateButton.textContent = "Checking host…";
    try {
      applyUpdate(await api<HostUpdate>("/api/app/update"));
    } catch (error) {
      updateStatus.textContent = (error as Error).message;
      updateButton.disabled = false;
      updateButton.textContent = "Retry host check";
      updateButton.onclick = () => { void checkForUpdates(); };
    }
  };
  const runUpdateAction = async (action: "download" | "install"): Promise<void> => {
    updateButton.disabled = true;
    try {
      applyUpdate(await api<HostUpdate>("/api/app/update", { method: "POST", body: { action } }));
    } catch (error) {
      updateStatus.textContent = (error as Error).message;
      updateButton.disabled = false;
      updateButton.textContent = "Retry host check";
      updateButton.onclick = () => { void checkForUpdates(); };
    }
  };
  updateButton.onclick = () => { void runUpdateAction("download"); };
  const pop = h("div", { id: "profile-popover", class: "card fixed bottom-3 left-3 z-50 max-h-[calc(100dvh-1.5rem)] w-[min(520px,calc(100vw-1.5rem))] space-y-4 overflow-y-auto p-4 shadow-2xl" });
  const close = (): void => { window.clearTimeout(updatePoll); if (crop) URL.revokeObjectURL(crop.url); pop.remove(); document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", keydown); };
  const outside = (event: MouseEvent): void => { if (!pop.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(); };
  const keydown = (event: KeyboardEvent): void => { if (event.key === "Escape") close(); };
  const acceptUser = (user: User): void => { S.me = user; const index = S.users.findIndex((item) => item.id === user.id); if (index >= 0) S.users[index] = user; };
  const save = async (): Promise<void> => {
    status.textContent = "Saving…";
    try {
      acceptUser((await api<{ user: User }>("/api/me/profile", { method: "PATCH", body: { display: display.value, job_title: jobTitle.value, description: description.value } })).user);
      const image = await renderedPhoto();
      if (image) {
        status.textContent = "Compressing and saving photo…";
        const response = await fetch("/api/me/avatar", { method: "POST", headers: { authorization: `Bearer ${getToken()}`, "content-type": image.type }, body: image });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        acceptUser(result.user);
      }
      status.textContent = "Profile saved.";
      close(); renderSidebar(); renderHeader();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  file.onchange = () => {
    const image = file.files?.[0]; if (!image) return;
    if (image.size > 25 * 1024 * 1024) { status.textContent = "Choose an image smaller than 25 MB."; return; }
    const url = URL.createObjectURL(image);
    const source = new Image();
    source.onload = () => {
      if (crop) URL.revokeObjectURL(crop.url);
      crop = { image: source, url, zoom: 1, x: 0, y: 0 };
      cropZoom.value = "1"; cropPanel.classList.remove("hidden"); centerCrop();
      status.textContent = "Photo ready. Adjust the crop, then choose Save profile.";
    };
    source.onerror = () => { URL.revokeObjectURL(url); status.textContent = "This image could not be opened."; };
    source.src = url;
  };
  pop.append(
    h("div", { class: "flex items-start justify-between gap-3" }, h("div", {}, h("h2", { class: "font-display text-xl text-fg" }, "Profile"), h("p", { class: "mt-1 text-xs text-muted" }, `@${S.me.username}`)), h("button", { class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close profile", onclick: close }, icon("x"))),
    h("div", { class: "flex items-center gap-3" }, photoSlot, h("div", { class: "flex flex-wrap gap-2" }, h("label", { class: "btn-subtle cursor-pointer text-xs" }, "Choose photo", file), S.me.avatar ? h("button", { class: "btn-ghost text-xs", onclick: async () => { acceptUser((await api<{ user: User }>("/api/me/avatar", { method: "DELETE" })).user); close(); renderSidebar(); renderHeader(); } }, "Remove") : null)),
    cropPanel,
    h("div", { class: "grid gap-3 sm:grid-cols-2" }, h("label", { class: "space-y-1 text-xs font-semibold text-fg" }, "Display name", display), h("label", { class: "space-y-1 text-xs font-semibold text-fg" }, "Job title", jobTitle)),
    h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Description", description),
    h("div", { class: "flex items-center justify-between gap-3" },
      status,
      h("button", { class: "btn-primary text-sm", onclick: () => { void save(); } }, "Save profile")),
    h("p", { class: "border-t border-line pt-3 text-xs leading-5 text-muted" },
      "1Helm is AGPL-3.0-only. ",
      h("a", { class: "text-accent hover:underline", href: "https://github.com/gitcommit90/1Helm", target: "_blank", rel: "noopener noreferrer" }, "View source code ↗")));
  if (S.me.is_admin) pop.append(h("section", { class: "flex items-center justify-between gap-3 border-t border-line pt-3", dataset: { profileUpdate: "" } },
    h("div", { class: "min-w-0" }, updateLabel, updateStatus),
    updateButton));
  document.body.append(pop);
  if (S.me.is_admin) void checkForUpdates();
  setTimeout(() => { document.addEventListener("mousedown", outside); document.addEventListener("keydown", keydown); }, 0);
}

const sbSection = (label: string, onAdd?: () => void): HTMLElement =>
  h("div", { class: "flex items-center justify-between px-2 pb-1" },
    h("span", { class: "eyebrow text-sidebar-muted" }, label),
    onAdd ? h("button", { class: "grid h-5 w-5 place-items-center rounded text-sidebar-muted hover:bg-sidebar-hover hover:text-white", title: "Add", onclick: onAdd }, "+") : null);

function newChannel(): void {
  openCreateChannel(async (created) => {
    await loadWorkspace();
    await openChannel(created.id);
  });
}
function newHumanChannel(): void {
  document.getElementById("new-human-channel")?.remove();
  const overlay = h("div", { id: "new-human-channel", class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-6", role: "dialog", "aria-modal": "true", "aria-label": "Create human channel" });
  const name = h("input", { class: "field", maxlength: 100, placeholder: "Channel name", autocomplete: "off", dataset: { humanChannelName: "" } }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-xs text-muted", dataset: { humanChannelStatus: "" } });
  const selected = new Set<number>();
  const people = h("div", { class: "max-h-52 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel p-2" });
  const others = S.users.filter((user) => user.id !== S.me.id);
  if (S.me.is_admin && others.length) {
    for (const user of others) {
      const checkbox = h("input", { type: "checkbox", class: "accent-accent", value: String(user.id) }) as HTMLInputElement;
      checkbox.onchange = () => { if (checkbox.checked) selected.add(user.id); else selected.delete(user.id); };
      people.append(h("label", { class: "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-fg hover:bg-hover" }, checkbox, avatar(user.display, "user", 6, user.avatar), h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate font-semibold" }, user.display), h("span", { class: "block truncate text-[11px] text-muted" }, `@${user.username}`))));
    }
  } else {
    people.append(h("p", { class: "px-2 py-2 text-xs leading-5 text-muted" }, S.me.is_admin ? "No other workspace members are available yet." : "The Captain can add workspace members when creating a shared human channel."));
  }
  const close = (): void => overlay.remove();
  const create = h("button", { class: "btn-primary min-h-11 px-4 text-sm", dataset: { humanChannelCreate: "" } }, "Create channel") as HTMLButtonElement;
  create.onclick = async () => {
    const channelName = name.value.trim().slice(0, 100);
    if (!channelName) { status.textContent = "Enter a channel name."; name.focus(); return; }
    create.disabled = true; status.textContent = "Creating human-only channel…";
    try {
      const result = await api<{ channel: Channel }>("/api/human-channels", { method: "POST", body: { name: channelName, member_ids: [...selected] } });
      close(); await loadWorkspace(); await openChannel(result.channel.id);
    } catch (error) { create.disabled = false; status.textContent = (error as Error).message; }
  };
  overlay.onclick = (event) => { if (event.target === overlay) close(); };
  overlay.append(h("section", { class: "card mobile-sheet w-full max-w-md overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl" },
    h("div", { class: "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6" }, h("div", {}, h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, "Create human channel"), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, "A private conversation for people only—no resident agent or channel computer.")), h("button", { class: "grid h-9 w-9 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close", onclick: close }, icon("x"))),
    h("div", { class: "space-y-3 p-4 sm:p-6" }, h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Name", name), h("div", {}, h("div", { class: "mb-1 text-xs font-semibold text-fg" }, "People"), people), status),
    h("div", { class: "flex justify-end gap-2 border-t border-line px-4 py-4 sm:px-6" }, h("button", { class: "btn-subtle min-h-11 px-4 text-sm", onclick: close }, "Cancel"), create)));
  document.body.append(overlay); name.focus();
}
function newDM(): void {
  const others = S.users.filter((u) => u.id !== S.me.id);
  if (!others.length) { void appAlert("No other users yet."); return; }
  pickList("Start a direct message", others.map((u) => ({ id: u.id, label: u.display + " · @" + u.username })), async (id) => {
    const r = await api<{ channel: Channel }>("/api/dm", { body: { userId: id } }); await loadWorkspace(); openChannel(r.channel.id);
  });
}

// ---------------- main chat ----------------
function openGlobalThreads(): void {
  S.globalThreadsOpen = true;
  S.threadRoot = null;
  // Resync unread badges from server — Threads inbox and channel list must agree.
  void loadWorkspace().then(() => renderApp()).catch(() => renderApp());
}

function renderMain(): void {
  const main = document.getElementById("main")!;
  // #msgs is destroyed on every shell rebuild. Capture scroll *before* clear so
  // open/close thread doesn't dump the user at the oldest message.
  const priorMsgs = document.getElementById("msgs");
  if (forceMsgsScrollBottom) {
    pendingMsgsScroll = { top: 0, stick: true };
  } else if (priorMsgs) {
    let stick = shouldStickScroll(priorMsgs);
    // Same-turn re-render (openThread right after openChannel) can still see scrollTop 0
    // before the rAF pin lands. Keep stick if the previous paint was stick-to-bottom.
    if (!stick && lastMsgsStick && priorMsgs.scrollTop === 0 && priorMsgs.scrollHeight > priorMsgs.clientHeight + 80) {
      stick = true;
    }
    pendingMsgsScroll = { top: priorMsgs.scrollTop, stick };
  } else {
    // First chat paint (boot / non-chat → chat): land on latest.
    pendingMsgsScroll = { top: 0, stick: true };
  }
  clear(main);
  if (S.globalThreadsOpen) {
    main.append(h("section", { class: "flex min-w-0 flex-1 flex-col" },
      h("div", { id: "hdr" }),
      h("div", { id: "channelview", class: "min-h-0 flex-1 overflow-y-auto" })));
    renderGlobalThreadsHeader();
    renderGlobalThreads(document.getElementById("channelview")!, {
      unreadOnly: S.globalThreadsUnreadOnly,
      onToggleUnread: (next) => { S.globalThreadsUnreadOnly = next; renderMain(); },
      onOpen: (thread) => {
        S.globalThreadsOpen = false;
        void openChannel(thread.channel_id, "chat", thread.root_message_id);
      },
    });
    return;
  }
  const channel = S.channels.find((item) => item.id === S.channelId);
  if (channel?.kind !== "channel") { S.view = "chat"; S.terminalOpen = false; S.notesOpen = false; }
  if (S.view !== "chat") {
    main.append(h("section", { class: "flex min-w-0 flex-1 flex-col" }, h("div", { id: "hdr" }), channelTabs(), h("div", { id: "channelview", class: "min-h-0 flex-1 overflow-y-auto" })));
    renderHeader(); renderChannelView();
    return;
  }
  const showRhs = !!(S.threadRoot
    || (S.terminalOpen && channel?.kind === "channel" && S.workspace?.terminals_enabled !== false)
    || (S.notesOpen && channel?.kind === "channel"));
  const rhsCount = Number(Boolean(S.threadRoot)) + Number(Boolean(S.terminalOpen)) + Number(Boolean(S.notesOpen));
  const split = rhsCount > 1;
  const parts: HTMLElement[] = [
    h("section", { class: "flex min-w-0 flex-1 flex-col" }, h("div", { id: "hdr" }), channel?.kind === "channel" ? channelTabs() : null, h("div", { id: "msgs", class: "flex-1 overflow-y-auto py-3" }), composer(null)),
  ];
  if (showRhs) {
    parts.push(h("aside", {
      id: "thread",
      class: `thread-pane flex shrink-0 flex-col border-l border-line bg-surface ${split ? "rhs-split" : ""}`,
    }));
  }
  main.append(...parts);
  renderHeader(); renderMessages();
  if (showRhs) renderRhs();
}

function renderRhs(): void {
  const el = document.getElementById("thread");
  if (!el) return;
  const rhsCount = Number(Boolean(S.threadRoot)) + Number(Boolean(S.terminalOpen)) + Number(Boolean(S.notesOpen));
  const split = rhsCount > 1;
  const priorThread = document.getElementById("threadmsgs");
  const priorTop = priorThread?.scrollTop ?? 0;
  const forceBottom = forceThreadScrollBottom;
  const stickThread = forceBottom || (priorThread ? shouldStickScroll(priorThread) : true);
  if (forceBottom) forceThreadScrollBottom = false;
  snapshotProgressOpenState(el);
  snapshotProgressOpenState(document.getElementById("msgs"));
  clear(el);
  el.className = `thread-pane flex shrink-0 flex-col border-l border-line bg-surface ${split ? "rhs-split" : ""}`;
  // Shared width resizer for the whole RHS (thread and/or terminal).
  const resizeHandle = h("div", {
    class: "thread-resizer absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize sm:block",
    role: "separator", tabindex: 0, "aria-label": "Resize side panel", "aria-orientation": "vertical",
  });
  const resize = (width: number): void => {
    const safe = Math.max(400, Math.min(width, Math.min(840, window.innerWidth - 420)));
    el.style.width = safe + "px";
    if (S.me?.id) localStorage.setItem(`1helm.threadWidth.${S.me.id}`, String(safe));
  };
  const storedWidth = Number(localStorage.getItem(`1helm.threadWidth.${S.me?.id || 0}`) || 520);
  if (window.innerWidth > 900) resize(storedWidth);
  resizeHandle.addEventListener("pointerdown", (event: PointerEvent) => {
    event.preventDefault(); resizeHandle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent): void => resize(window.innerWidth - next.clientX);
    const stop = (): void => { resizeHandle.removeEventListener("pointermove", move); resizeHandle.removeEventListener("pointerup", stop); };
    resizeHandle.addEventListener("pointermove", move); resizeHandle.addEventListener("pointerup", stop);
  });
  resizeHandle.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(el.getBoundingClientRect().width + (event.key === "ArrowLeft" ? 24 : -24)); }
  });
  el.append(resizeHandle);

  let mounted = 0;
  const paneClass = (): string => {
    mounted += 1;
    return `flex min-h-0 min-w-0 flex-col ${split ? `flex-1 ${mounted < rhsCount ? "border-b border-line" : ""}` : "min-h-0 flex-1"}`;
  };
  if (S.threadRoot) {
    const threadBox = h("div", {
      id: "thread-panel",
      class: paneClass(),
    });
    el.append(threadBox);
    paintThreadPanel(threadBox, priorTop, stickThread, forceBottom);
  }
  if (S.terminalOpen) {
    const termBox = h("div", {
      id: "term-dock",
      class: `term-dock ${paneClass()}`,
    });
    el.append(termBox);
    paintDockedTerminal(termBox);
  }
  if (S.notesOpen) {
    const notesBox = h("div", { id: "notes-dock", class: paneClass() });
    el.append(notesBox);
    renderNotes(notesBox, S.channelId, closeDockedNotes);
  }
}

function paintDockedTerminal(container: HTMLElement): void {
  const preferred = S.preferredTerminalComputerId ?? defaultTerminalComputer(S.channelId);
  openTerminals(container, S.channelId, {
    preferredComputerId: preferred || undefined,
    serversListOpen: S.serversListOpen,
    docked: true,
    onClose: closeDockedTerminal,
    onChromeChange: () => {
      const chrome = getTerminalChrome(S.channelId);
      if (!chrome) return;
      S.serversListOpen = chrome.serversListOpen;
      S.preferredTerminalComputerId = chrome.preferredComputerId;
      persistCurrentChannelView();
    },
  });
  requestAnimationFrame(() => refitChannelTerminals(S.channelId));
}

function renderGlobalThreadsHeader(): void {
  const el = document.getElementById("hdr"); if (!el) return;
  clear(el);
  el.className = "app-topbar flex min-h-12 flex-wrap items-start justify-between gap-2 border-b border-line bg-surface px-2 py-1.5 sm:items-center sm:gap-3 sm:px-4 sm:py-2.5";
  add(el,
    h("div", { class: "flex min-w-0 items-center gap-2" },
      mobileMenuButton(),
      h("span", { class: "shrink-0 text-accent" }, icon("thread", 18)),
      h("div", { class: "min-w-0" },
        h("div", { class: "truncate font-semibold text-fg" }, "Threads"),
        h("div", { class: "truncate text-xs text-muted" }, "Across all agent channels"))),
    h("div", { class: "flex shrink-0 items-center gap-1" },
      h("button", {
        type: "button",
        class: `btn-subtle min-h-11 text-xs sm:min-h-0 ${S.globalThreadsUnreadOnly ? "border-accent/40 bg-accent-soft text-accent" : ""}`,
        "aria-pressed": String(S.globalThreadsUnreadOnly),
        onclick: () => { S.globalThreadsUnreadOnly = !S.globalThreadsUnreadOnly; renderMain(); },
      }, S.globalThreadsUnreadOnly ? "Unread · on" : "Unread · off")));
}

function textsAvailable(channel?: Channel): boolean {
  return Boolean(S.me.is_admin && S.photonConfigured && channel?.kind === "channel" && channel.name === "main" && channel.personal_main);
}

function channelTabs(): HTMLElement {
  const currentChannel = S.channels.find((channel) => channel.id === S.channelId);
  const tabs: [ChannelView, string][] = [
    ["chat", "Chat"], ["texts", "Texts"], ["board", "Board"], ["threads", "Threads"], ["notes", "Notes"], ["files", "Files"],
    ["terminal", "Terminal"], ["memory", "Memory"], ["activity", "Activity"], ["settings", "Settings"],
  ];
  return h("nav", { class: "flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-surface px-3" }, ...tabs
    .filter(([id]) => id !== "texts" || textsAvailable(currentChannel))
    .filter(([id]) => id !== "terminal" || S.workspace?.terminals_enabled !== false)
    .filter(([id]) => id !== "terminal" || currentChannel?.agent?.kind === "channel" || S.me.is_admin)
    .filter(([id]) => id !== "settings" || Boolean(currentChannel?.can_manage))
    .map(([id, label]) => h("button", { class: `view-tab ${S.view === id ? "view-tab-active" : "view-tab-idle"}`, dataset: { channelView: id }, onclick: () => navigateChannelView(id) }, label)));
}

export function navigateChannelView(view: ChannelView): void {
  if (view === "texts" && !textsAvailable(S.channels.find((channel) => channel.id === S.channelId))) view = "chat";
  S.view = view; S.threadRoot = null; S.globalThreadsOpen = false;
  if (view === "terminal") {
    S.terminalOpen = false;
    S.preferredTerminalComputerId = S.preferredTerminalComputerId ?? getChannelView(S.channelId).preferredComputerId ?? defaultTerminalComputer(S.channelId);
  }
  if (view === "notes") S.notesOpen = false;
  persistCurrentChannelView();
  renderApp();
  writeRoute(S.channels.find((channel) => channel.id === S.channelId), view, null);
}

/** Header Terminals — dock RHS like a thread. Never pops computer picker. */
export function openTerminalsFromHeader(): void {
  if (S.workspace?.terminals_enabled === false) {
    void appAlert("Terminals are disabled for this workspace.");
    return;
  }
  const channel = S.channels.find((item) => item.id === S.channelId);
  if (!channel || channel.kind !== "channel") {
    void appAlert("Open an agent channel to use terminals.");
    return;
  }
  if (channel.status === "archived") {
    void appAlert("Restore the channel before opening a terminal.");
    return;
  }
  // Toggle docked terminal on this channel. Stay on chat (or current non-terminal tab → chat).
  if (S.view === "terminal") S.view = "chat";
  if (S.view !== "chat") {
    S.view = "chat";
  }
  S.terminalOpen = !S.terminalOpen;
  if (S.terminalOpen && !S.preferredTerminalComputerId) {
    S.preferredTerminalComputerId = getChannelView(channel.id).preferredComputerId ?? defaultTerminalComputer(channel.id);
  }
  if (!S.terminalOpen) S.serversListOpen = false;
  persistCurrentChannelView();
  renderApp();
  writeRoute(channel, "chat", S.threadRoot?.id ?? null);
}

/** Header Notes — dock RHS like a thread or terminal while keeping chat visible. */
export function openNotesFromHeader(): void {
  const channel = S.channels.find((item) => item.id === S.channelId);
  if (!channel || channel.kind !== "channel") {
    void appAlert("Open an agent channel to use notes.");
    return;
  }
  if (channel.status === "archived") {
    void appAlert("Restore the channel before editing its notes.");
    return;
  }
  if (S.view !== "chat") S.view = "chat";
  S.notesOpen = !S.notesOpen;
  persistCurrentChannelView();
  renderApp();
  writeRoute(channel, "chat", S.threadRoot?.id ?? null);
}

function openTerminalOnComputer(computerId: number): void {
  // Full-tab path (channel Terminal tab / legacy).
  S.preferredTerminalComputerId = computerId;
  S.view = "terminal";
  S.terminalOpen = false;
  S.threadRoot = null;
  persistCurrentChannelView();
  renderApp();
  writeRoute(S.channels.find((channel) => channel.id === S.channelId), "terminal", null);
}

export function renderChannelView(): void {
  const container = document.getElementById("channelview");
  const channel = S.channels.find((item) => item.id === S.channelId);
  if (!container || !channel) return;
  if (S.view === "texts") renderTexts(container, S.selectedTextConversationId || undefined, (id) => { S.selectedTextConversationId = id; renderChannelView(); });
  else if (S.view === "board") renderBoard(container, channel.id, (root) => {
    if (!S.messages.some((message) => message.id === root.id)) S.messages.push(root);
    S.messages.sort((a, b) => a.id - b.id);
    S.view = "chat";
    renderApp();
    void openThread(root);
  });
  else if (S.view === "threads") renderThreads(container, channel.id, (thread) => { S.view = "chat"; renderApp(); void openThread(thread.root); });
  else if (S.view === "notes") renderNotes(container, channel.id);
  else if (S.view === "files") renderFiles(container, channel.id);
  else if (S.view === "memory") renderMemory(container, channel.id);
  else if (S.view === "activity") renderActivity(container, channel.id);
  else if (S.view === "terminal") openTerminals(container, channel.id, S.preferredTerminalComputerId || undefined);
  else if (S.view === "settings") renderChannelSettings(container, channel, async (deleted) => {
    await loadWorkspace();
    if (deleted || !S.channels.some((item) => item.id === S.channelId)) {
      S.channelId = S.channels.find((item) => item.name === "main" && item.kind === "channel")?.id || S.channels[0]?.id || 0;
      S.view = "chat";
      if (S.channelId) await openChannel(S.channelId); else renderApp();
    } else {
      // Keep channel settings live (avatar / model) without a hard page reload.
      await reloadBots();
      if (S.channelId) {
        const data = await api<{ messages: Message[]; bots: Bot[] }>(`/api/channels/${S.channelId}/messages`);
        S.messages = data.messages;
        S.channelBots = data.bots;
      }
      renderApp();
    }
  });
}

function renderHeader(): void {
  const el = document.getElementById("hdr"); if (!el) return;
  const channel = S.channels.find((item) => item.id === S.channelId);
  const agent = channel?.agent;
  clear(el);
  el.className = "app-topbar flex min-h-12 items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1.5 sm:gap-3 sm:px-4 sm:py-2.5";
  const statusTone = agent?.status === "working" ? "bg-amber-400 animate-pulse" : agent?.status === "waiting" ? "bg-blue-400" : agent?.status === "archived" || agent?.status === "paused" ? "bg-faint" : "bg-ok";
  const callSkipper = (): void => {
    S.view = "chat"; renderApp();
    queueMicrotask(() => {
      const target = S.threadRoot ? String(S.threadRoot.id) : "root";
      const input = document.querySelector<HTMLTextAreaElement>(`textarea[data-composer-parent="${target}"]`);
      if (input) { input.value = "@skipper "; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
  };
  const terminalsEnabled = S.workspace?.terminals_enabled !== false && (agent?.kind === "channel" || S.me.is_admin);
  const toggleFavorite = async (): Promise<void> => {
    if (!channel) return;
    const favorite = !channel.favorite;
    channel.favorite = favorite;
    renderHeader(); renderSidebar();
    try {
      const result = await api<{ channel?: Channel }>(`/api/channels/${channel.id}/favorite`, { method: "PATCH", body: { favorite } });
      if (result.channel) mergeChannelMeta(result.channel);
      renderHeader(); renderSidebar();
    } catch (error) {
      channel.favorite = !favorite;
      renderHeader(); renderSidebar();
      void appAlert((error as Error).message);
    }
  };
  add(el,
    h("div", { class: "flex min-w-0 flex-1 items-center gap-2 overflow-hidden" },
      mobileMenuButton(),
      h("div", { class: "flex min-w-0 max-w-[46%] shrink items-center gap-1 text-[15px] font-semibold leading-5 tracking-[-0.01em] text-fg sm:max-w-none sm:text-[16px]" }, channel?.kind === "dm" ? null : h("span", { class: "shrink-0 font-normal text-faint" }, "#"), h("span", { class: "min-w-0 truncate", title: channel?.name || "" }, channel?.name || "")),
      channel?.purpose ? h("span", { class: "hidden min-w-0 max-w-[min(38vw,32rem)] truncate border-l border-line pl-2.5 text-[12px] leading-4 text-muted 2xl:block", title: channel.purpose }, channel.purpose) : null,
      channel?.status === "archived" ? h("span", { class: "chip shrink-0" }, "Paused") : null),
    h("div", { class: "flex max-w-[52%] shrink-0 items-center justify-end gap-1.5 sm:max-w-none sm:gap-2" },
      channel ? h("button", {
        class: `grid h-11 w-11 place-items-center rounded-md border border-transparent transition hover:border-line hover:bg-hover sm:h-9 sm:w-9 ${channel.favorite ? "text-accent" : "text-muted hover:text-fg"}`,
        title: channel.favorite ? "Remove from Favorites" : "Add to Favorites", "aria-label": channel.favorite ? "Remove current channel from Favorites" : "Favorite current channel",
        "aria-pressed": String(Boolean(channel.favorite)), dataset: { favoriteChannel: String(channel.id) }, onclick: () => { void toggleFavorite(); },
      }, starIcon(Boolean(channel.favorite))) : null,
      h("button", {
        class: "grid h-11 w-11 place-items-center rounded-md border border-transparent text-muted transition hover:border-line hover:bg-hover hover:text-fg sm:h-9 sm:w-9",
        title: "Open live 1Helm Router activity", "aria-label": "Open 1Helm Router", dataset: { routingHeader: "" }, onclick: (event: MouseEvent) => { void openRoutingPopover(event).catch((error) => appAlert((error as Error).message)); },
      }, routerSymbolIcon()),
      agent ? h("button", { class: "flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 font-mono text-[10px] text-muted transition hover:border-line hover:bg-hover hover:text-fg sm:min-h-0 sm:max-w-[14rem] sm:gap-2 sm:px-2 sm:text-[11px]", title: `${agent.display_name || agent.name} · ${agent.status} · ${agent.provider_kind === "routing" ? "Model fabric" : agent.provider_name || "no provider"} · ${agent.model || "no model"}`, onclick: channel?.can_manage ? () => navigateChannelView("settings") : undefined },
        h("span", { class: `h-1.5 w-1.5 shrink-0 rounded-full ${statusTone}` }), h("span", { class: "min-w-0 truncate" }, "@" + agent.name),
        h("span", { class: "hidden max-w-28 truncate text-faint 2xl:inline" }, agent.model || "no model")) : null,
      terminalsEnabled ? h("button", {
        class: `grid h-11 w-11 place-items-center rounded-md border border-transparent text-muted transition hover:border-line hover:bg-hover hover:text-fg sm:h-9 sm:w-9 ${S.terminalOpen || S.view === "terminal" ? "border-line bg-hover text-fg" : ""}`,
        title: "Terminals", "aria-label": "Open terminals", onclick: openTerminalsFromHeader,
      }, icon("terminal", 18)) : null,
      channel?.kind === "channel" ? h("button", {
        class: `grid h-11 w-11 place-items-center rounded-md border border-transparent text-muted transition hover:border-line hover:bg-hover hover:text-fg sm:h-9 sm:w-9 ${S.notesOpen || S.view === "notes" ? "border-line bg-hover text-fg" : ""}`,
        title: "Notes", "aria-label": "Open channel notes", dataset: { notesHeader: "" }, onclick: openNotesFromHeader,
      }, icon("file", 18)) : null,
      channel?.kind === "channel" ? h("button", { class: "btn-subtle min-h-11 px-2.5 text-xs sm:min-h-0 sm:px-3", title: "Call Skipper", onclick: callSkipper }, helmMark(14), h("span", { class: "hidden xl:inline" }, "Call Skipper")) : null));
}

function starIcon(filled: boolean): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("fill", filled ? "currentColor" : "none");
  svg.innerHTML = '<path d="m12 2.8 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9L6.4 20l1.1-6.2L3 9.4l6.2-.9L12 2.8z"/>';
  return svg;
}
function routerSymbolIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h3c3 0 3-6 7-6M10 12c3 0 3 6 7 6"/>';
  return svg;
}

function progressOpenIn(root: ParentNode | null): boolean {
  return !!root?.querySelector("details.agent-progress[open]");
}

function progressOpenSticky(): boolean {
  // Live DOM first (still present until clear()). Then Map for currently visible
  // messages only — never treat another channel's leftover open state as sticky.
  if (progressOpenIn(document.getElementById("msgs")) || progressOpenIn(document.getElementById("thread"))) return true;
  for (const message of S.messages || []) if (progressOpenByMessage.get(message.id)) return true;
  if (S.threadRoot) {
    if (progressOpenByMessage.get(S.threadRoot.id)) return true;
    for (const reply of S.threadReplies || []) if (progressOpenByMessage.get(reply.id)) return true;
  }
  return false;
}

function shouldStickScroll(box: HTMLElement | null, forceBottom = false): boolean {
  if (!box) return false;
  // Fresh channel/thread open always lands on latest — ignore prior scrollTop (0 on new #msgs)
  // and leftover work-log open state from another channel.
  if (forceBottom) return true;
  // Never pin-to-bottom while a work log is open (channel or thread). Also block when
  // the Map says a disclosure is open even if the live node was just cleared.
  if (progressOpenSticky()) return false;
  return box.scrollHeight - box.scrollTop - box.clientHeight < 80;
}

/** Keep the viewport stable across full list rebuilds when stick-to-bottom is off. */
function restoreScroll(box: HTMLElement | null, priorTop: number, stick: boolean): void {
  if (!box) return;
  if (stick) {
    box.scrollTop = box.scrollHeight;
    return;
  }
  // Clamping avoids jump-to-top when content shrinks, and keeps the same message
  // under the user's eyes when Working expands/collapses mid-stream.
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  box.scrollTop = Math.min(Math.max(0, priorTop), max);
}

function channelLinks(): ChannelLink[] {
  return (S.channels || [])
    .filter((channel) => channel.kind === "channel" && channel.status !== "archived")
    .map((channel) => ({ name: channel.name, slug: channel.slug || String(channel.id) }));
}

function renderMessageBody(body: string): HTMLElement {
  const el = h("div", { class: "md min-w-0 max-w-full text-fg", dataset: { liveSlot: "body" }, html: md(body, { channels: channelLinks() }) });
  el.querySelectorAll("a.channel-mention[data-channel-slug]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const slug = (node as HTMLElement).dataset.channelSlug || "";
      const channel = S.channels.find((item) => item.slug === slug || item.name === slug);
      if (channel) void openChannel(channel.id);
    });
  });
  return el;
}

function renderMessages(): void {
  const box = document.getElementById("msgs"); if (!box) return;
  snapshotProgressOpenState(box);
  snapshotProgressOpenState(document.getElementById("thread"));
  // Prefer handoff from renderMain (shell rebuild) over live #msgs (often brand-new, scrollTop 0).
  const pending = pendingMsgsScroll;
  pendingMsgsScroll = null;
  // Channel hop / first paint: forceMsgsScrollBottom. Shell rebuild: pending.stick from prior #msgs.
  const useForce = forceMsgsScrollBottom;
  forceMsgsScrollBottom = false;
  const priorTop = pending ? pending.top : box.scrollTop;
  const stick = useForce ? true : (pending ? pending.stick : shouldStickScroll(box));
  clear(box);
  if (!S.messages.length) { box.append(emptyState(S.channels.find((c) => c.id === S.channelId))); return; }
  let prev: Message | null = null;
  // One section per calendar day so sticky date chips only pin while that
  // day's messages are in view — sibling stickies under #msgs all fight for top-0.
  let daySection: HTMLElement | null = null;
  for (const m of S.messages) {
    if (!prev || !sameDay(prev.created, m.created)) {
      daySection = h("div", { class: "msg-day-section", dataset: { messageDay: new Date(m.created).toDateString() } });
      daySection.append(dateDivider(m.created));
      box.append(daySection);
    }
    const grouped = !!prev && sameDay(prev.created, m.created) && prev.author.kind === m.author.kind && prev.author.id === m.author.id && m.created - prev.created < 5 * 60 * 1000 && !m.attachments?.length;
    daySection!.append(messageRow(m, { grouped, inThread: false }));
    prev = m;
  }
  restoreScroll(box, priorTop, stick);
  lastMsgsStick = stick;
  // Re-pin after flex layout settles. Channel hop needs an extra frame; live stick is 1.
  if (useForce) pinScrollBottom("msgs", 2);
  else if (stick) pinScrollBottom("msgs", 1);
}

function messageGroupedAt(messages: Message[], index: number): boolean {
  const current = messages[index];
  const previous = index > 0 ? messages[index - 1] : null;
  return !!previous && sameDay(previous.created, current.created)
    && previous.author.kind === current.author.kind
    && previous.author.id === current.author.id
    && current.created - previous.created < 5 * 60 * 1000
    && !current.attachments?.length;
}

function messageRowSelector(surface: "channel" | "thread", id: number): string {
  return `[data-message-surface="${surface}"][data-message-id="${id}"]`;
}

/** Refresh the active channel and thread message rows without touching either composer. */
function paintLiveMessage(message: Message): void {
  const channelMessageId = Number(message.parent_id ?? message.id);
  paintLiveChannelMessage(channelMessageId);
  if (S.threadRoot && (Number(message.id) === Number(S.threadRoot.id) || Number(message.parent_id) === Number(S.threadRoot.id))) {
    paintLiveThreadMessage(message);
  }
}

function paintLiveChannelMessage(messageId: number): void {
  const box = document.getElementById("msgs");
  const index = S.messages.findIndex((message) => Number(message.id) === Number(messageId));
  if (!box || index < 0) return;
  const priorTop = box.scrollTop;
  const stick = shouldStickScroll(box);
  const replaceAt = (at: number): boolean => {
    const message = S.messages[at];
    if (!message) return false;
    const prior = box.querySelector<HTMLElement>(messageRowSelector("channel", message.id));
    if (!prior) return false;
    snapshotProgressOpenState(prior);
    patchLiveMessageRow(prior, messageRow(message, { grouped: messageGroupedAt(S.messages, at), inThread: false }));
    return true;
  };

  if (!replaceAt(index)) {
    // Live messages normally arrive in chronological order. If a reconnect
    // supplies an older insertion, use the scroll-preserving list renderer.
    if (index !== S.messages.length - 1) {
      renderMessages();
      return;
    }
    if (box.querySelector(":scope > :not(.msg-day-section)")) clear(box);
    const message = S.messages[index];
    const previous = index > 0 ? S.messages[index - 1] : null;
    let section = previous && sameDay(previous.created, message.created)
      ? box.querySelector<HTMLElement>(`:scope > .msg-day-section:last-of-type`)
      : null;
    if (!section) {
      section = h("div", { class: "msg-day-section", dataset: { messageDay: new Date(message.created).toDateString() } });
      section.append(dateDivider(message.created));
      box.append(section);
    }
    section.append(messageRow(message, { grouped: messageGroupedAt(S.messages, index), inThread: false }));
  }
  // Grouping of the immediately following row depends on the updated row.
  replaceAt(index + 1);
  restoreScroll(box, priorTop, stick);
  lastMsgsStick = stick;
  if (stick) pinScrollBottom("msgs", 1);
}

function fillThreadMessages(box: HTMLElement): void {
  if (!S.threadRoot) return;
  clear(box);
  box.append(
    messageRow(S.threadRoot, { grouped: false, inThread: true }),
    h("div", { class: "eyebrow mx-4 my-2 flex items-center gap-3 text-faint", dataset: { threadReplyCount: "1" } },
      h("span", {}, `${S.threadReplies.length} ${S.threadReplies.length === 1 ? "reply" : "replies"}`),
      h("div", { class: "h-px flex-1 bg-line" })),
    ...S.threadReplies.map((reply) => messageRow(reply, { grouped: false, inThread: true })),
  );
}

function paintLiveThreadMessage(message: Message): void {
  const box = document.getElementById("threadmsgs");
  if (!box || !S.threadRoot) return;
  const priorTop = box.scrollTop;
  const stick = shouldStickScroll(box);
  const target = Number(message.id) === Number(S.threadRoot.id)
    ? S.threadRoot
    : S.threadReplies.find((reply) => Number(reply.id) === Number(message.id));
  if (target) {
    const prior = box.querySelector<HTMLElement>(messageRowSelector("thread", target.id));
    if (prior) {
      snapshotProgressOpenState(prior);
      patchLiveMessageRow(prior, messageRow(target, { grouped: false, inThread: true }));
    } else if (Number(target.parent_id) === Number(S.threadRoot.id)
      && S.threadReplies.at(-1)?.id === target.id) {
      box.append(messageRow(target, { grouped: false, inThread: true }));
    } else {
      snapshotProgressOpenState(box);
      fillThreadMessages(box);
    }
  }
  const count = box.querySelector<HTMLElement>("[data-thread-reply-count] span");
  if (count) count.textContent = `${S.threadReplies.length} ${S.threadReplies.length === 1 ? "reply" : "replies"}`;
  restoreScroll(box, priorTop, stick);
  if (stick) pinScrollBottom("threadmsgs", 1);
}

/** Keep the row and rendered-body node stable while a streamed message changes.
 * This preserves selection/focus owned by adjacent UI and avoids the visible
 * whole-row teardown that previously happened every ~75 ms. */
function patchLiveMessageRow(current: HTMLElement, next: HTMLElement): void {
  const currentBody = current.querySelector<HTMLElement>('[data-live-slot="body"]');
  const nextBody = next.querySelector<HTMLElement>('[data-live-slot="body"]');
  if (currentBody && nextBody) {
    currentBody.className = nextBody.className;
    currentBody.replaceChildren(...Array.from(nextBody.childNodes));
    nextBody.replaceWith(currentBody);
  }
  current.className = next.className;
  for (const name of next.getAttributeNames()) {
    if (name === "class") continue;
    current.setAttribute(name, next.getAttribute(name) || "");
  }
  current.replaceChildren(...Array.from(next.childNodes));
}

function emptyState(c: Channel | undefined): HTMLElement {
  return h("div", { class: "flex h-full flex-col items-center justify-center gap-4 px-6 text-center" },
    h("div", { class: "brand-mark grid h-14 w-14 place-items-center rounded-lg" }, c?.kind === "dm" ? helmMark(25) : icon("hash", 24)),
    h("div", {},
      h("div", { class: "font-display text-[1.7rem] leading-tight text-fg" }, c?.kind === "dm" ? c.name : "#" + (c?.name || "")),
      c?.agent ? h("div", { class: "eyebrow mt-2 text-faint" }, `Resident agent · @${c.agent.name}`) : null),
    h("p", { class: "max-w-md text-sm leading-6 text-muted" }, c?.agent ? `This is @${c.agent.name}'s durable world. Start a focused session, attach a file, or call @skipper for broader help.` : "Start a message or focused thread."));
}

function dateDivider(ts: number): HTMLElement {
  return h("div", { class: "my-1.5 flex items-center gap-3 px-4" },
    h("div", { class: "h-px flex-1 bg-line" }),
    h("span", { class: "eyebrow shrink-0 text-faint" }, dayLabel(ts)),
    h("div", { class: "h-px flex-1 bg-line" }));
}

function closeOpenMessageActions(except?: HTMLElement) {
  document.querySelectorAll(".group.message-actions-open").forEach((el) => {
    if (except && el === except) return;
    el.classList.remove("message-actions-open");
  });
}

function isCoarsePointer(): boolean {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function wireMessageActionReveal(row: HTMLElement, actions: HTMLElement, moreBtn: HTMLElement) {
  // Touch: ⋯ or long-press expands the sticky rail. Desktop is CSS hover/focus-within.
  let pressTimer: number | null = null;
  const clearPress = () => {
    if (pressTimer != null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  const setOpen = (open: boolean, e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    closeOpenMessageActions(open ? row : undefined);
    row.classList.toggle("message-actions-open", open);
  };
  const toggleOpen = (e: Event) => setOpen(!row.classList.contains("message-actions-open"), e);

  moreBtn.addEventListener("click", (e) => toggleOpen(e));

  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    if ((e.target as HTMLElement | null)?.closest?.("button,a,input,textarea,summary")) return;
    clearPress();
    pressTimer = window.setTimeout(() => setOpen(true, e), 420);
  });
  row.addEventListener("pointerup", clearPress);
  row.addEventListener("pointercancel", clearPress);
  row.addEventListener("pointerleave", clearPress);
  row.addEventListener("contextmenu", (e) => {
    if (isCoarsePointer()) setOpen(true, e);
  });
  actions.addEventListener("click", (e) => e.stopPropagation());

  // One document listener is enough; rebinding per row is fine (idempotent close).
  if (!(document as any).__1helmMsgActionsDoc) {
    (document as any).__1helmMsgActionsDoc = true;
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".message-actions, .group.message-actions-open")) return;
      closeOpenMessageActions();
    }, true);
  }
}

function messageIsWorking(m: Message): boolean {
  if (m.progress?.some((item) => item.status === "running")) return true;
  // Placeholder body only — sticky interim thoughts keep real body text while progress is running.
  if (m.author.kind === "bot" && (!m.body || m.body === "_Working…_")) return true;
  return false;
}

function rootHasWorkingActivity(root: Message): boolean {
  if (messageIsWorking(root)) return true;
  if (S.threadRoot?.id === root.id) return S.threadReplies.some(messageIsWorking);
  // Channel stream only has roots; treat recent unreplied agent activity via reply_count + last_reply is weak.
  // Prefer explicit progress on the root when present.
  return Boolean(root.progress?.some((item) => item.status === "running"));
}

function messageRow(m: Message, opts: { grouped: boolean; inThread: boolean }): HTMLElement {
  const isBot = m.author.kind === "bot";
  const running = opts.inThread ? messageIsWorking(m) : (m.parent_id == null ? rootHasWorkingActivity(m) : messageIsWorking(m));
  // Sticky thought: show real interim text instead of flashing "_Working…_" between tools.
  const body = isBot && running ? workingDisplayBody(m) : (m.body || (isBot ? "_Working…_" : ""));
  const bodyHtml = renderMessageBody(body);
  const canDelete = S.me.is_admin || (!isBot && m.author.kind === "user" && m.author.id === S.me.id);
  const replyBtn = h("button", {
    class: "message-action grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover hover:text-fg sm:h-7 sm:w-7",
    title: opts.inThread ? "Focus reply" : "Reply in thread",
    "aria-label": opts.inThread ? "Focus reply composer" : "Reply in thread",
    onclick: () => {
      closeOpenMessageActions();
      if (opts.inThread) focusThreadComposer();
      else void openThread(m.parent_id != null ? (S.messages.find((x) => x.id === m.parent_id) || m) : m);
    },
  }, icon("thread"));
  const deleteBtn = canDelete
    ? h("button", {
      class: "message-action grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover hover:text-danger sm:h-7 sm:w-7",
      title: "Delete message",
      "aria-label": "Delete message",
      onclick: () => {
        closeOpenMessageActions();
        void deleteMessageUi(m);
      },
    }, icon("trash", 14))
    : null;
  const stopBtn = running ? h("button", {
    class: "message-action grid h-11 w-11 place-items-center rounded text-danger hover:bg-danger/10 sm:h-7 sm:w-7",
    title: "Stop this agent turn now",
    "aria-label": "Stop agent turn",
    onclick: async () => {
      closeOpenMessageActions();
      const rootId = Number(m.parent_id || m.id);
      try { await api(`/api/messages/${rootId}/stop`, { body: {} }); }
      catch (error) { void appAlert((error as Error).message); }
    },
  }, h("span", { class: "h-2.5 w-2.5 rounded-[2px] bg-current", "aria-hidden": "true" })) : null;
  // Sticky right rail (not absolute top-right) so long messages keep controls in frame.
  const moreBtn = h("button", {
    class: "message-more grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover hover:text-fg sm:h-7 sm:w-7",
    title: "Message actions",
    "aria-label": "Message actions",
    "aria-haspopup": "true",
  }, icon("more", 16));
  const actions = h("div", {
    class: "message-actions",
    role: "toolbar",
    "aria-label": "Message actions",
  }, moreBtn, stopBtn, replyBtn, deleteBtn);

  const chipText = running ? workingChipLabel(m) : "";
  const workingChip = running && !opts.inThread
    ? h("span", {
      class: "chip inline-flex max-w-[min(100%,28rem)] items-center gap-1.5 border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
      title: chipText,
    },
        h("span", { class: "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" }),
        h("span", { class: "min-w-0 truncate" }, chipText))
    : null;

  const content = h("div", { class: "min-w-0 flex-1 pr-12" },
    opts.grouped ? null : h("div", { class: "flex items-baseline gap-2" },
      h("span", { class: "text-[13.5px] font-semibold text-fg hover:underline sm:text-[14.5px]" }, m.author.name),
      isBot ? h("span", { class: "font-mono text-[9px] uppercase tracking-[0.16em] text-accent" }, "Agent") : null,
      h("span", { class: "font-mono text-[10.5px] text-faint" }, timeLabel(m.created)),
      workingChip),
    bodyHtml, structuredQuestions(m), progressDisclosure(m), attachments(m), threadFooter(m, opts.inThread));

  const botAvatar = (bot: Bot | undefined) => bot?.avatar || undefined;
  const row = opts.grouped
    ? h("div", { class: "group relative flex min-w-0 max-w-full items-start gap-2.5 px-3 py-0.5 hover:bg-hover sm:px-4" },
      h("span", { class: "w-9 shrink-0 pt-0.5 text-right font-mono text-[9.5px] leading-5 text-transparent group-hover:text-faint" }, new Date(m.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(/\s?[AP]M/i, "")),
      content, actions)
    : h("div", { class: "group relative flex min-w-0 max-w-full items-start gap-2.5 px-3 py-0.5 hover:bg-hover sm:px-4" },
      avatar(m.author.name, m.author.kind, 9, isBot ? botAvatar(S.channelBots.find((b) => b.name === m.author.name)) : undefined),
      content, actions);

  row.dataset.messageId = String(m.id);
  row.dataset.messageSurface = opts.inThread ? "thread" : "channel";

  if (!opts.inThread) {
    row.classList.add("cursor-pointer");
    row.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, summary, details, .message-actions, .attachments")) return;
      void openThread(m.parent_id != null ? (S.messages.find((x) => x.id === m.parent_id) || m) : m);
    });
  }

  wireMessageActionReveal(row, actions, moreBtn);
  return row;
}

type QuestionDraft = { values: Set<string>; custom: string; customOpen: boolean };
const questionDrafts = new Map<string, QuestionDraft>();
const questionDraftKey = (messageId: number, questionId: string): string => `${messageId}:${questionId}`;

function structuredQuestions(message: Message): HTMLElement | null {
  const interview = message.questions;
  if (!interview?.questions?.length) return null;
  if (interview.status !== "pending") {
    for (const question of interview.questions) questionDrafts.delete(questionDraftKey(message.id, question.id));
    return h("div", { class: "mt-3 rounded-lg border border-line bg-raised/40 p-3" },
      h("div", { class: "flex items-center gap-2 text-xs font-semibold text-fg" }, icon("check", 14), "Interview answered"),
      ...(interview.answers || []).map((answer) => h("div", { class: "mt-2 text-xs leading-5 text-muted" }, h("span", { class: "font-semibold text-fg" }, answer.question + " "), [...answer.values, answer.custom].filter(Boolean).join(", "))));
  }
  const body = h("div", { class: "mt-3 space-y-3 rounded-xl border border-accent/30 bg-accent-soft p-3.5" });
  body.append(h("div", {}, h("div", { class: "flex items-center gap-2 font-semibold text-fg" }, icon("help", 16), "A few choices before I continue"), interview.intro ? h("p", { class: "mt-1 text-sm leading-5 text-muted" }, interview.intro) : null));
  for (const question of interview.questions) {
    const key = questionDraftKey(message.id, question.id);
    const current = questionDrafts.get(key) || { values: new Set<string>(), custom: "", customOpen: false };
    questionDrafts.set(key, current);
    const options = h("div", { class: "mt-2 flex flex-wrap gap-2" });
    const custom = h("input", { class: `field mt-2 ${current.customOpen ? "" : "hidden"}`, placeholder: "Type something…", maxlength: 4000, value: current.custom }) as HTMLInputElement;
    const buttons: HTMLButtonElement[] = [];
    const repaint = (): void => buttons.forEach((button) => {
      const selected = current.values.has(button.dataset.value || "");
      button.classList.toggle("border-accent", selected);
      button.classList.toggle("bg-accent", selected);
      button.classList.toggle("text-white", selected);
      button.classList.toggle("shadow-sm", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    for (const option of question.options) {
      const button = h("button", {
        class: "rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-fg transition hover:border-accent/60 hover:bg-hover",
        type: "button", "aria-pressed": "false",
        dataset: { value: option.label }, title: option.description || option.label,
        onclick: (event: MouseEvent) => {
          event.preventDefault(); event.stopPropagation();
          if (question.multi_select) current.values.has(option.label) ? current.values.delete(option.label) : current.values.add(option.label);
          else { current.values.clear(); current.values.add(option.label); }
          repaint();
        },
      }, h("span", { class: "font-semibold" }, option.label), option.description ? h("span", { class: "mt-0.5 block text-xs text-muted" }, option.description) : null) as HTMLButtonElement;
      buttons.push(button); options.append(button);
    }
    repaint();
    options.append(h("button", { class: "rounded-lg border border-dashed border-line bg-transparent px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg", type: "button", onclick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); current.customOpen = !current.customOpen; custom.classList.toggle("hidden", !current.customOpen); if (current.customOpen) custom.focus(); } }, "Type something"));
    custom.addEventListener("input", () => { current.custom = custom.value.trim(); });
    custom.addEventListener("click", (event) => event.stopPropagation());
    body.append(h("section", { class: "rounded-lg border border-line/70 bg-surface/70 p-3" }, question.header ? h("div", { class: "eyebrow text-accent" }, question.header) : null, h("p", { class: "mt-1 text-sm font-semibold leading-5 text-fg" }, question.question), options, custom));
  }
  const status = h("p", { class: "min-h-5 text-xs text-muted" });
  const submit = h("button", { class: "btn-primary text-sm", type: "button", onclick: async (event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    const missing = interview.questions.find((question) => {
      const draft = questionDrafts.get(questionDraftKey(message.id, question.id));
      return !draft?.values.size && !draft?.custom.trim();
    });
    if (missing) { status.textContent = `Answer “${missing.question}” before continuing.`; return; }
    status.textContent = "Sending answers…"; (submit as HTMLButtonElement).disabled = true;
    try {
      const result = await api<{ questions?: AgentQuestions }>(`/api/messages/${message.id}/questions/answer`, { body: { answers: interview.questions.map((question) => { const draft = questionDrafts.get(questionDraftKey(message.id, question.id)); return { question_id: question.id, values: [...(draft?.values || [])], custom: draft?.custom || "" }; }) } });
      if (result.questions) { message.questions = result.questions; paintLiveMessage(message); }
    } catch (error) { status.textContent = (error as Error).message; (submit as HTMLButtonElement).disabled = false; }
  } }, "Continue") as HTMLButtonElement;
  body.append(h("div", { class: "flex items-center justify-between gap-3" }, status, submit));
  return body;
}

// Survives full message-list re-renders. DOM query alone fails because
// renderMessages/renderThread call clear() before rebuilding rows, so the old
// <details open> is already gone when progressDisclosure runs.
const progressOpenByMessage = new Map<number, boolean>();
const progressStepOpen = new Map<string, boolean>(); // `${messageId}:${progressId}`
// Inner work-log scroller (`.progress-timeline`). Full rebuilds reset scrollTop to 0
// unless we snapshot + restore — that felt like "auto-scroll up" on every tick.
const progressTimelineScroll = new Map<number, { top: number; stick: boolean }>();

function snapshotProgressOpenState(root: ParentNode | null = document): void {
  root?.querySelectorAll("details.agent-progress[data-progress-for]").forEach((node) => {
    const el = node as HTMLDetailsElement;
    const id = Number(el.dataset.progressFor);
    if (!Number.isFinite(id)) return;
    progressOpenByMessage.set(id, el.open);
    const timeline = el.querySelector(".progress-timeline") as HTMLElement | null;
    if (timeline) {
      const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 48;
      progressTimelineScroll.set(id, { top: timeline.scrollTop, stick: nearBottom });
    }
  });
  root?.querySelectorAll("details.progress-step[data-step-key]").forEach((node) => {
    const el = node as HTMLDetailsElement;
    const key = el.dataset.stepKey;
    if (key) progressStepOpen.set(key, el.open);
  });
}

function progressStatusTone(status: string): string {
  if (status === "running") return "animate-pulse bg-amber-400";
  if (status === "failed") return "bg-danger";
  return "bg-ok";
}

function progressStatusLabel(status: string): string {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "done";
}

function humanToolName(raw: string): string {
  return raw.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

/** Split tool progress body: "name: input" then optional "\\nresult". */
function parseToolBody(body: string): { title: string; input: string; output: string } {
  const text = body || "";
  const nl = text.indexOf("\n");
  const head = nl >= 0 ? text.slice(0, nl) : text;
  const rest = nl >= 0 ? text.slice(nl + 1).trim() : "";
  const colon = head.indexOf(":");
  if (colon < 0) return { title: humanToolName(head) || "tool", input: "", output: rest };
  return {
    title: humanToolName(head.slice(0, colon)) || "tool",
    input: head.slice(colon + 1).trim(),
    output: rest,
  };
}

function progressPreviewLine(items: AgentProgress[]): string {
  // Live current step only (running tool / thinking / status). Do NOT fall back to a
  // completed thought — that forced the summary preview to snap after every tool tick.
  const running = [...items].reverse().find((item) => item.status === "running") || items[items.length - 1];
  if (!running) return "";
  if (running.kind === "tool") {
    const { title, input } = parseToolBody(running.body);
    return input ? `${title} · ${input.slice(0, 72)}` : title;
  }
  if (running.kind === "thinking") {
    const line = running.body.trim().split(/\n+/).find(Boolean) || "Thinking…";
    return line.slice(0, 80) + (line.length > 80 ? "…" : "");
  }
  return (running.body || "Working…").slice(0, 80);
}

function stickyThoughtFromProgress(items: AgentProgress[] | undefined): string {
  if (!items?.length) return "";
  const thought = [...items].reverse().find((item) => item.kind === "thinking" && item.body.trim());
  return thought?.body.trim() || "";
}

/** Replace only the literal "Working…" label — not the whole summary row. */
function stickyWorkingLabel(items: AgentProgress[] | undefined): string {
  const sticky = stickyThoughtFromProgress(items);
  if (!sticky) return "Working…";
  const line = sticky.split(/\n+/).find(Boolean) || sticky;
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

/** Body shown while an agent turn is mid-flight — keep last real thought sticky. */
function workingDisplayBody(m: Message): string {
  if (m.body && m.body !== "_Working…_") return m.body;
  const sticky = stickyThoughtFromProgress(m.progress);
  return sticky || m.body || "_Working…_";
}

function workingChipLabel(m: Message): string {
  // Same rule as the work-log left label: sticky thought, else Working…
  if (m.progress?.length) return stickyWorkingLabel(m.progress);
  if (m.body && m.body !== "_Working…_") {
    const line = m.body.trim().split(/\n+/).find(Boolean) || "Working…";
    return line.length > 72 ? `${line.slice(0, 72)}…` : line;
  }
  return "Working…";
}

function progressCounts(items: AgentProgress[]): string {
  const tools = items.filter((i) => i.kind === "tool").length;
  const thoughts = items.filter((i) => i.kind === "thinking").length;
  const parts: string[] = [];
  if (tools) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (thoughts) parts.push(`${thoughts} thought${thoughts === 1 ? "" : "s"}`);
  if (!parts.length) parts.push(`${items.length} step${items.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function progressStepCard(messageId: number, item: AgentProgress): HTMLElement {
  const key = `${messageId}:${item.id}`;
  const tone = progressStatusTone(item.status);
  const statusChip = h("span", {
    class: `chip shrink-0 border-line/60 text-[10px] font-semibold uppercase tracking-wide ${
      item.status === "running" ? "border-amber-400/30 text-amber-600 dark:text-amber-300"
        : item.status === "failed" ? "border-danger/30 text-danger" : "text-muted"
    }`,
  }, progressStatusLabel(item.status));

  if (item.kind === "status") {
    return h("div", { class: "progress-step progress-step-status flex items-start gap-2.5 rounded-lg border border-line/80 bg-surface/80 px-3 py-2" },
      h("span", { class: `mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}` }),
      h("div", { class: "min-w-0 flex-1 text-xs leading-5 text-muted" }, item.body || "…"),
      statusChip);
  }

  if (item.kind === "thinking") {
    const text = (item.body || "").trim() || "…";
    const long = text.length > 280 || text.split("\n").length > 4;
    const wasOpen = progressStepOpen.get(key) === true;
    if (!long) {
      return h("div", { class: "progress-step progress-step-thinking rounded-lg border border-line/80 bg-raised/40 px-3 py-2" },
        h("div", { class: "mb-1.5 flex items-center gap-2" },
          h("span", { class: `h-2 w-2 shrink-0 rounded-full ${tone}` }),
          h("span", { class: "font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Thinking"),
          h("span", { class: "flex-1" }),
          statusChip),
        h("div", { class: "whitespace-pre-wrap break-words text-xs leading-5 text-muted italic" }, text));
    }
    const open = wasOpen || item.status === "running";
    progressStepOpen.set(key, open);
    const d = h("details", {
      class: "progress-step progress-step-thinking rounded-lg border border-line/80 bg-raised/40",
      dataset: { stepKey: key },
      open: open || undefined,
    },
      h("summary", { class: "flex cursor-pointer select-none items-center gap-2 px-3 py-2" },
        h("span", { class: `h-2 w-2 shrink-0 rounded-full ${tone}` }),
        h("span", { class: "font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Thinking"),
        h("span", { class: "min-w-0 flex-1 truncate text-xs text-muted" }, text.slice(0, 96) + (text.length > 96 ? "…" : "")),
        statusChip),
      h("div", { class: "max-h-56 overflow-y-auto border-t border-line/70 px-3 py-2" },
        h("div", { class: "whitespace-pre-wrap break-words text-xs leading-5 text-muted italic" }, text))) as HTMLDetailsElement;
    d.addEventListener("toggle", () => progressStepOpen.set(key, d.open));
    return d;
  }

  // tool
  const { title, input, output } = parseToolBody(item.body || "");
  const longOut = output.length > 360 || output.split("\n").length > 6;
  const outOpen = progressStepOpen.get(key) === true;

  const titleRow = h("div", { class: "flex flex-wrap items-center gap-2" },
    h("span", { class: `h-2 w-2 shrink-0 rounded-full ${tone}` }),
    h("span", { class: "font-mono text-[9.5px] uppercase tracking-[0.16em] text-accent" }, "Tool"),
    h("span", { class: "font-semibold text-fg text-xs" }, title),
    h("span", { class: "flex-1" }),
    statusChip);
  const inputEl = input ? h("div", { class: "mt-1.5 font-mono text-[11px] leading-4 text-muted break-all" }, input) : null;
  const resultBlock = (maxH: string) => h("div", { class: "border-t border-line/70 bg-raised/30 px-3 py-2" },
    h("div", { class: "mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Result"),
    h("pre", { class: `progress-output m-0 ${maxH} overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted` }, output));

  if (!output) {
    return h("div", { class: "progress-step progress-step-tool rounded-lg border border-line bg-surface px-3 py-2" }, titleRow, inputEl);
  }

  if (!longOut) {
    return h("div", { class: "progress-step progress-step-tool rounded-lg border border-line bg-surface" },
      h("div", { class: "px-3 py-2" }, titleRow, inputEl),
      resultBlock("max-h-48"));
  }

  progressStepOpen.set(key, outOpen);
  const toggleHint = h("div", { class: "mt-1.5 text-[11px] font-medium text-accent", dataset: { resultToggle: "1" } },
    outOpen ? "Hide result" : `Show result · ${output.length.toLocaleString()} chars`);
  const d = h("details", {
    class: "progress-step progress-step-tool rounded-lg border border-line bg-surface",
    dataset: { stepKey: key },
    open: outOpen || undefined,
  },
    h("summary", { class: "cursor-pointer select-none px-3 py-2" },
      titleRow,
      inputEl,
      toggleHint),
    resultBlock("max-h-64")) as HTMLDetailsElement;
  d.addEventListener("toggle", () => {
    progressStepOpen.set(key, d.open);
    toggleHint.textContent = d.open ? "Hide result" : `Show result · ${output.length.toLocaleString()} chars`;
  });
  return d;
}

function progressDisclosure(message: Message): HTMLElement | null {
  if (!message.progress?.length) return null;
  const items = message.progress;
  const running = items.some((item) => item.status === "running");
  const prev = document.querySelector(
    `details.agent-progress[data-progress-for="${message.id}"]`,
  ) as HTMLDetailsElement | null;
  const open = prev ? prev.open : (progressOpenByMessage.get(message.id) === true);
  progressOpenByMessage.set(message.id, open);
  const preview = progressPreviewLine(items);
  // Prefer live DOM scroll (still present until parent clear), else sticky Map.
  let timelineScroll = progressTimelineScroll.get(message.id);
  if (prev) {
    const live = prev.querySelector(".progress-timeline") as HTMLElement | null;
    if (live) {
      const nearBottom = live.scrollHeight - live.scrollTop - live.clientHeight < 48;
      timelineScroll = { top: live.scrollTop, stick: nearBottom };
      progressTimelineScroll.set(message.id, timelineScroll);
    }
  }
  const timeline = h("div", {
    class: "progress-timeline space-y-2 border-t border-line/80 px-3 py-3",
    dataset: { progressTimelineFor: String(message.id) },
  }, ...items.map((item) => progressStepCard(message.id, item)));
  const details = h("details", {
    class: "agent-progress mt-2 overflow-hidden rounded-lg border border-line bg-raised/50 shadow-sm",
    dataset: { progressFor: String(message.id) },
    open: open || undefined,
  },
    h("summary", { class: "flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-muted hover:bg-hover/60 hover:text-fg" },
      h("span", { class: `h-2 w-2 shrink-0 rounded-full ${running ? "animate-pulse bg-amber-400" : "bg-ok"}` }),
      // Left label only: sticky thought replaces literal "Working…". Layout unchanged —
      // secondary preview (current step) + counts stay separate.
      h("span", {
        class: "max-w-[min(100%,18rem)] shrink-0 truncate",
        title: running ? stickyWorkingLabel(items) : "Work log",
      }, running ? stickyWorkingLabel(items) : "Work log"),
      h("span", { class: "hidden min-w-0 flex-1 truncate font-normal text-faint sm:inline" }, preview),
      h("span", { class: "shrink-0 font-normal text-faint" }, progressCounts(items))),
    timeline) as HTMLDetailsElement;
  details.addEventListener("toggle", () => {
    progressOpenByMessage.set(message.id, details.open);
  });
  // Restore after paint so scrollHeight is real. Stick only if the user was already
  // at the bottom of this box; otherwise keep their place (no snap-to-top).
  if (timelineScroll) {
    const saved = timelineScroll;
    requestAnimationFrame(() => {
      const max = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
      if (saved.stick) timeline.scrollTop = timeline.scrollHeight;
      else timeline.scrollTop = Math.min(Math.max(0, saved.top), max);
      progressTimelineScroll.set(message.id, {
        top: timeline.scrollTop,
        stick: timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 48,
      });
    });
  }
  timeline.addEventListener("scroll", () => {
    progressTimelineScroll.set(message.id, {
      top: timeline.scrollTop,
      stick: timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 48,
    });
  }, { passive: true });
  return details;
}

function focusThreadComposer(): void {
  const el = document.querySelector<HTMLTextAreaElement>('#thread textarea[data-composer-parent]');
  if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }); }
}

async function deleteMessageUi(m: Message): Promise<void> {
  const isRoot = m.parent_id == null;
  const warn = isRoot && m.reply_count > 0
    ? `Delete this session and all ${m.reply_count} ${m.reply_count === 1 ? "reply" : "replies"}?`
    : "Delete this message?";
  if (!(await appConfirm(warn))) return;
  try {
    // Apply from HTTP body immediately. Live peers still get WS `message_deleted`;
    // without this, a flaky/reconnecting socket leaves the tombstone until full reload.
    const result = await api<{
      id: number;
      channel_id: number;
      parent_id: number | null;
      deleted_ids?: number[];
      parent?: { id: number; reply_count: number; last_reply: number | null };
    }>(`/api/messages/${m.id}`, { method: "DELETE" });
    applyMessageDeleted({
      channelId: result.channel_id ?? m.channel_id,
      messageId: result.id ?? m.id,
      parentId: result.parent_id !== undefined ? result.parent_id : m.parent_id,
      deletedIds: result.deleted_ids?.length ? result.deleted_ids : [m.id],
      parent: result.parent,
    });
  } catch (error) {
    void appAlert((error as Error).message || "Could not delete message");
  }
}

function threadFooter(m: Message, inThread: boolean): HTMLElement | null {
  if (inThread || m.reply_count <= 0) return null;
  const last = m.last_reply ? timeLabel(m.last_reply) : "";
  return h("button", { class: "mt-1 flex w-fit items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-xs font-semibold text-accent hover:border-line hover:bg-surface", onclick: () => openThread(m) },
    icon("thread"), `${m.reply_count} ${m.reply_count === 1 ? "reply" : "replies"}`, last ? h("span", { class: "font-normal text-muted" }, "· last " + last) : null);
}

function attachments(m: Message): HTMLElement | null {
  if (!m.attachments?.length) return null;
  return h("div", { class: "mt-1.5 flex flex-wrap gap-2" }, ...m.attachments.map((a) => {
    const viewUrl = `/api/files/${a.id}`;
    const mediaUrl = `${viewUrl}?token=${encodeURIComponent(getToken())}`;
    const actions = h("div", { class: "flex items-center gap-1 border-t border-line/70 px-2 py-1.5" },
      h("button", { class: "btn-subtle text-xs", type: "button", onclick: (event: MouseEvent) => { event.stopPropagation(); void openAuthenticatedFile(viewUrl).catch((error) => appAlert((error as Error).message)); } }, "Open"),
      h("button", { class: "btn-subtle text-xs", type: "button", onclick: (event: MouseEvent) => { event.stopPropagation(); void downloadAuthenticatedFile(`${viewUrl}?download=1`, a.name).catch((error) => appAlert((error as Error).message)); } }, "Download"));
    if (a.mime.startsWith("image/")) return h("article", { class: "overflow-hidden rounded-lg border border-line bg-raised" },
      h("button", { type: "button", class: "block", onclick: (event: MouseEvent) => { event.stopPropagation(); void openAuthenticatedFile(viewUrl).catch((error) => appAlert((error as Error).message)); } }, h("img", { src: mediaUrl, class: "max-h-64 object-contain", alt: a.name })), actions);
    return h("article", { class: "overflow-hidden rounded-lg border border-line bg-raised text-sm" },
      h("button", { type: "button", class: "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover", onclick: (event: MouseEvent) => { event.stopPropagation(); void openAuthenticatedFile(viewUrl).catch((error) => appAlert((error as Error).message)); } },
        h("span", { class: "grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent" }, icon("file")),
        h("div", { class: "min-w-0" }, h("div", { class: "truncate font-medium text-fg" }, a.name), h("div", { class: "text-xs text-muted" }, fmtSize(a.size)))), actions);
  }));
}

// ---------------- thread panel ----------------
async function openThread(root: Message, replaceRoute = false): Promise<void> {
  const data = await api<{ root: Message; replies: Message[]; followup?: ThreadFollowup | null; usage?: ThreadUsage }>(`/api/messages/${root.id}/thread`);
  S.threadRoot = data.root;
  S.threadReplies = data.replies;
  S.threadFollowup = data.followup || null;
  S.threadUsage = {
    input_tokens: Math.max(0, Number(data.usage?.input_tokens || 0)),
    output_tokens: Math.max(0, Number(data.usage?.output_tokens || 0)),
  };
  // Ensure chat shell + RHS (thread may split with docked terminal).
  if (S.view !== "chat") S.view = "chat";
  // Fresh thread open always lands on latest replies (same class of bug as channel hop).
  forceThreadScrollBottom = true;
  renderMain();
  persistCurrentChannelView();
  writeRoute(S.channels.find((channel) => channel.id === S.channelId), "chat", root.id, replaceRoute);
}
function closeThread(): void {
  S.threadRoot = null;
  S.threadFollowup = null;
  S.threadUsage = { input_tokens: 0, output_tokens: 0 };
  persistCurrentChannelView();
  renderMain();
  writeRoute(S.channels.find((channel) => channel.id === S.channelId), "chat", null);
}
function closeDockedTerminal(): void {
  S.terminalOpen = false;
  S.serversListOpen = false;
  persistCurrentChannelView();
  renderMain();
}

function closeDockedNotes(): void {
  S.notesOpen = false;
  persistCurrentChannelView();
  renderMain();
}

/** Compact token count for the thread header (1.2k, 340, …). */
function formatRoughTokens(n: number): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (v >= 1000) {
    const k = v / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(v);
}

function threadUsageLabel(usage: ThreadUsage = S.threadUsage): string {
  return `Used ${formatRoughTokens(usage.input_tokens)} in · ${formatRoughTokens(usage.output_tokens)} out`;
}

function paintThreadCtx(): void {
  const el = document.getElementById("thread-ctx");
  if (!el) return;
  const label = threadUsageLabel();
  el.textContent = label;
  el.setAttribute("title", `Cumulative provider-reported usage for this thread · ${S.threadUsage.input_tokens} input tokens · ${S.threadUsage.output_tokens} output tokens. This is usage, not remaining context-window capacity.`);
  el.classList.toggle("hidden", !(S.threadUsage.input_tokens || S.threadUsage.output_tokens));
}

function formatThreadFollowupCountdown(dueAt: number, nowMs = Date.now()): string {
  const remaining = Math.max(0, Math.floor((dueAt - nowMs) / 1000));
  if (remaining <= 0) return "now";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

let threadFollowupTimer: number | null = null;
function stopThreadFollowupTicker(): void {
  if (threadFollowupTimer != null) window.clearInterval(threadFollowupTimer);
  threadFollowupTimer = null;
}
function tickThreadFollowup(): void {
  const banner = document.querySelector<HTMLElement>("[data-thread-followup]");
  const countdown = banner?.querySelector<HTMLElement>("[data-thread-followup-countdown]");
  if (!banner || !countdown || !S.threadFollowup) { stopThreadFollowupTicker(); return; }
  const dueAt = Number(S.threadFollowup.due_at || 0);
  countdown.textContent = formatThreadFollowupCountdown(dueAt);
  countdown.classList.toggle("text-danger", dueAt <= Date.now());
  countdown.classList.toggle("text-accent", dueAt > Date.now());
}
function residentFollowupName(): string {
  return S.channels.find((channel) => channel.id === S.channelId)?.agent?.name || "Agent";
}
function threadFollowupBanner(): HTMLElement | null {
  const followup = S.threadFollowup;
  if (!followup?.due_at || followup.status !== "pending") return null;
  const intent = String(followup.check_hint || followup.reason || "").trim();
  return h("div", {
    class: "mx-3 mb-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 sm:mx-4",
    dataset: { threadFollowup: String(followup.id) },
    role: "status",
    title: `Scheduled wake at ${new Date(Number(followup.due_at)).toLocaleString()}`,
  },
    h("div", { class: "flex min-w-0 items-center gap-2 text-xs" },
      h("span", { class: "shrink-0 text-accent" }, icon("helm", 15)),
      h("span", { class: "min-w-0 flex-1 text-fg" }, h("strong", {}, `@${residentFollowupName()}`), " will check back in ",
        h("span", { class: "font-mono tabular-nums text-accent", dataset: { threadFollowupCountdown: "" } }, formatThreadFollowupCountdown(Number(followup.due_at)))),
      h("span", { class: "hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-faint sm:inline" }, "scheduled")),
    intent ? h("p", { class: "mt-1 line-clamp-2 pl-[23px] text-[11px] leading-4 text-muted" }, intent) : null);
}
function paintThreadFollowup(): void {
  const existing = document.querySelector<HTMLElement>("[data-thread-followup]");
  const next = threadFollowupBanner();
  if (existing && next) existing.replaceWith(next);
  else if (existing) existing.remove();
  else if (next) document.querySelector<HTMLElement>("#thread-panel .composer-wrap")?.before(next);
  stopThreadFollowupTicker();
  if (next) { tickThreadFollowup(); threadFollowupTimer = window.setInterval(tickThreadFollowup, 1000); }
}

/** Fill the thread half (or full RHS) inside an already-built #thread shell. */
function paintThreadPanel(box: HTMLElement, priorTop = 0, stickThread = true, forceBottom = false): void {
  if (!S.threadRoot) return;
  clear(box);
  const channelName = S.channels.find((c) => c.id === S.channelId)?.name || "";
  const hasUsage = !!(S.threadUsage.input_tokens || S.threadUsage.output_tokens);
  const ctxChip = h("span", {
    id: "thread-ctx",
    class: `thread-ctx select-none font-mono text-[10px] font-normal tracking-tight text-faint tabular-nums ${hasUsage ? "" : "hidden"}`,
    title: `Cumulative provider-reported usage for this thread · ${S.threadUsage.input_tokens} input tokens · ${S.threadUsage.output_tokens} output tokens. This is usage, not remaining context-window capacity.`,
  }, threadUsageLabel());
  const followupBanner = threadFollowupBanner();
  box.append(
    h("div", { class: "app-topbar thread-topbar flex min-h-12 items-center justify-between gap-2 border-b border-line px-2 py-1.5 sm:gap-3 sm:px-4 sm:py-2.5" },
      h("div", { class: "flex min-w-0 items-center gap-1.5 sm:gap-2" },
        h("button", {
          class: "btn-subtle inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2.5 text-sm sm:min-h-9",
          title: "Back to channel",
          "aria-label": "Close thread and return to channel",
          onclick: closeThread,
        }, icon("chevronLeft", 18), h("span", { class: "font-semibold" }, "Back")),
        h("div", { class: "min-w-0" },
          h("div", { class: "truncate text-[15px] font-semibold text-fg" }, "Thread"),
          h("div", { class: "truncate font-mono text-[10.5px] text-faint" }, channelName ? `#${channelName}` : "Channel chat"))),
      h("div", { class: "flex shrink-0 items-center gap-1.5 sm:gap-2" },
        ctxChip,
        h("button", {
          class: "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-9 sm:w-9",
          title: "Close thread",
          "aria-label": "Close thread",
          onclick: closeThread,
        }, icon("x", 18)))),
    h("div", { id: "threadmsgs", class: "thread-messages min-w-0 flex-1 overflow-y-auto overflow-x-hidden py-2" }),
    ...(followupBanner ? [followupBanner] : []),
    composer(S.threadRoot.id));
  const tm = document.getElementById("threadmsgs");
  if (tm) fillThreadMessages(tm);
  stopThreadFollowupTicker();
  if (S.threadFollowup) { tickThreadFollowup(); threadFollowupTimer = window.setInterval(tickThreadFollowup, 1000); }
  restoreScroll(tm, priorTop, stickThread);
  if (forceBottom) pinScrollBottom("threadmsgs");
}

/** Live message updates while thread is open — surgically refresh thread half when possible. */
function renderThread(): void {
  if (!S.threadRoot) return;
  const panel = document.getElementById("thread-panel");
  const el = document.getElementById("thread");
  if (!el) {
    renderMain();
    return;
  }
  if (panel) {
    const prior = document.getElementById("threadmsgs");
    const priorTop = prior?.scrollTop ?? 0;
    snapshotProgressOpenState(panel);
    const forceBottom = forceThreadScrollBottom;
    const stickThread = forceBottom || (prior ? shouldStickScroll(prior) : true);
    if (forceBottom) forceThreadScrollBottom = false;
    paintThreadPanel(panel, priorTop, stickThread, forceBottom);
    return;
  }
  // RHS missing thread half (e.g. only terminal was open) — rebuild shell.
  renderMain();
}

// ---------------- composer ----------------
type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
let activeSpeech: { recognition: BrowserSpeechRecognition; input: HTMLTextAreaElement; button: HTMLButtonElement } | null = null;

function speechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  const browser = window as Window & { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition || null;
}
function speechRecognitionAvailable(): boolean { return !!speechRecognitionConstructor(); }
function microphoneIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "17"); svg.setAttribute("height", "17");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>';
  return svg;
}
function activeComposerInput(): HTMLTextAreaElement | null {
  const parent = S.threadRoot ? String(S.threadRoot.id) : "root";
  return document.querySelector<HTMLTextAreaElement>(`textarea[data-composer-parent="${parent}"]`);
}
async function toggleSpeechToText(input = activeComposerInput()): Promise<void> {
  if (!input) return;
  if (activeSpeech) {
    const wasThisInput = activeSpeech.input === input;
    activeSpeech.recognition.stop();
    if (wasThisInput) return;
  }
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    await appAlert("Speech-to-text is not available in this browser. Try the current 1Helm desktop app or a browser with SpeechRecognition support; typing and attachments still work normally.");
    return;
  }
  const button = input.closest(".composer-wrap")?.querySelector<HTMLButtonElement>("[data-speech-toggle]");
  if (!button) return;
  const recognition = new Recognition();
  const original = input.value;
  const joiner = original && !/\s$/.test(original) ? " " : "";
  let finalTranscript = "";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = document.documentElement.lang || navigator.language || "en-US";
  recognition.onresult = (event: any) => {
    let interim = "";
    for (let index = Number(event.resultIndex || 0); index < Number(event.results?.length || 0); index += 1) {
      const transcript = String(event.results[index]?.[0]?.transcript || "");
      if (event.results[index]?.isFinal) finalTranscript += transcript;
      else interim += transcript;
    }
    input.value = original + joiner + finalTranscript + interim;
    input.selectionStart = input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event("input"));
  };
  recognition.onerror = (event: any) => {
    const reason = String(event.error || "speech recognition failed");
    button.title = reason === "not-allowed" ? "Microphone access was not allowed" : `Speech-to-text stopped: ${reason}`;
  };
  recognition.onend = () => {
    button.setAttribute("aria-pressed", "false");
    button.classList.remove("bg-danger/15", "text-danger");
    button.title = "Dictate · tap Option/Alt to toggle";
    if (activeSpeech?.recognition === recognition) activeSpeech = null;
  };
  activeSpeech = { recognition, input, button };
  button.setAttribute("aria-pressed", "true");
  button.classList.add("bg-danger/15", "text-danger");
  button.title = "Listening… tap again or tap Option/Alt to stop";
  input.focus();
  try { recognition.start(); }
  catch (error) {
    activeSpeech = null;
    recognition.onend?.();
    await appAlert(`Speech-to-text could not start: ${(error as Error).message}`);
  }
}

function composer(parentId: number | null): HTMLElement {
  const channel = S.channels.find((item) => item.id === S.channelId);
  const humanOnly = ["collab", "human"].includes(channel?.kind || "");
  const attachBar = h("div", { class: "flex flex-wrap gap-2 px-1 pt-1 empty:hidden" });
  const input = h("textarea", { class: "max-h-44 min-h-[24px] w-full resize-none bg-transparent px-1 py-1 text-[15px] text-fg outline-none placeholder:text-faint", rows: 1, dataset: { composerParent: parentId == null ? "root" : String(parentId) }, placeholder: parentId ? "Reply…" : humanOnly ? "Message your coworkers…" : "Start a session — mention the resident agent or @skipper" }) as HTMLTextAreaElement;
  const mentionBox = h("div", { class: "absolute bottom-full left-0 right-0 z-20 mb-2 hidden max-h-[50vh] w-full max-w-sm overflow-y-auto overflow-hidden rounded-lg border border-line bg-surface shadow-xl sm:right-auto sm:w-72" });
  const draftKey = `1helm.draft.${S.me.id}.${S.channelId}.${parentId == null ? "root" : parentId}`;
  const savedDraft = localStorage.getItem(draftKey);
  if (savedDraft) input.value = savedDraft;
  let selectedPolicy: ModelPolicy | null = null;
  const agent = channel?.agent;
  const modelButton = h("button", {
    class: "model-picker-button btn-subtle min-h-11 min-w-0 max-w-[48%] gap-1.5 px-2.5 text-xs sm:min-h-8 sm:max-w-[240px]",
    title: "Choose the provider and model for this thread",
    onclick: (event: MouseEvent) => { void composerModelPopover(event, parentId, selectedPolicy, (policy) => { selectedPolicy = policy; drawModelButton(); }); },
  }) as HTMLButtonElement;
  const drawModelButton = (): void => {
    const policy = selectedPolicy;
    modelButton.replaceChildren(icon("sliders", 13), h("span", { class: "truncate font-mono text-[11px] font-normal" }, policy?.model || agent?.model || "Choose model"));
    modelButton.title = policy ? `${policy.provider_name || "Provider"} · ${policy.model}` : `Inherited model · ${agent?.model || "not configured"}`;
    modelButton.disabled = !agent;
  };
  drawModelButton();
  if (parentId) void api<{ policy: ModelPolicy }>(`/api/messages/${parentId}/model-policy`).then((result) => { selectedPolicy = result.policy; drawModelButton(); }).catch(() => undefined);

  const drawAttach = (): void => { clear(attachBar); pending.forEach((p, i) => attachBar.append(h("span", { class: "file-pill" }, icon("file", 13), p.name, h("button", { class: "text-faint hover:text-danger", onclick: () => { pending.splice(i, 1); drawAttach(); } }, "✕")))); };
  const send = async (): Promise<void> => {
    const body = input.value.trim(); if (!body && !pending.length) return;
    const uploads = pending.slice();
    const originalValue = input.value;
    input.value = ""; input.style.height = "auto"; localStorage.removeItem(draftKey);
    pending.splice(0, uploads.length); drawAttach();
    try {
      await api(`/api/channels/${S.channelId}/messages`, { body: { body, parentId, uploads, modelPolicy: selectedPolicy && !parentId ? { provider_id: selectedPolicy.provider_id, model: selectedPolicy.model } : undefined } });
    } catch (error) {
      if (!input.value) { input.value = originalValue; input.dispatchEvent(new Event("input")); }
      pending.unshift(...uploads); drawAttach();
      void appAlert((error as Error).message || "Could not send message");
    }
  };
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 176) + "px"; localStorage.setItem(draftKey, input.value); composerAutocomplete(input, mentionBox); });
  input.addEventListener("keydown", (ev) => {
    const k = ev as KeyboardEvent;
    if (!mentionBox.classList.contains("hidden") && ["Enter", "Tab", "ArrowDown", "ArrowUp"].includes(k.key)) { if (handleComposerSuggestKey(k, mentionBox, input)) { k.preventDefault(); return; } }
    if (k.key === "Escape") mentionBox.classList.add("hidden");
    if (k.key === "Tab" && !k.shiftKey && !k.altKey && !k.ctrlKey && !k.metaKey && !input.value.trim() && channel?.agent?.name) {
      k.preventDefault();
      input.value = `@${channel.agent.name} `;
      input.selectionStart = input.selectionEnd = input.value.length;
      input.dispatchEvent(new Event("input"));
      return;
    }
    if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); send(); }
  });

  const micButton = h("button", {
    class: "grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-8 sm:w-8",
    type: "button",
    title: speechRecognitionAvailable() ? "Dictate · tap Option/Alt to toggle" : "Speech-to-text is unavailable in this browser",
    "aria-label": "Toggle speech-to-text",
    "aria-pressed": "false",
    dataset: { speechToggle: "" },
    onclick: () => { void toggleSpeechToText(input); },
  }, microphoneIcon()) as HTMLButtonElement;

  const box = h("div", { class: "relative rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--c-accent-soft)]" },
    mentionBox, attachBar,
    h("div", { class: "px-2 pt-1.5" }, input),
    h("div", { class: "flex items-center justify-between gap-1 px-1.5 pb-1.5" },
      h("div", { class: "flex items-center gap-0.5" },
        h("label", { class: "grid h-11 w-11 cursor-pointer place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-8 sm:w-8", title: "Attach files" }, icon("paperclip"),
          h("input", { type: "file", multiple: true, class: "hidden", onchange: async (ev: Event) => { for (const f of Array.from((ev.target as HTMLInputElement).files || [])) pending.push(await uploadFile(f)); drawAttach(); } })),
        micButton),
      h("div", { class: "flex min-w-0 flex-1 justify-end gap-1.5" }, humanOnly ? null : modelButton,
        h("button", { class: "btn-primary min-h-11 shrink-0 px-3 text-sm sm:min-h-8", onclick: send }, icon("send"), "Send"))));
  const wrap = h("div", { class: "composer-wrap shrink-0 bg-bg px-3 pb-3 pt-1 sm:px-4 sm:pb-4" }, box);

  wrap.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("border-accent", "shadow-[0_0_0_3px_var(--c-accent-soft)]"); });
  wrap.addEventListener("dragleave", () => box.classList.remove("border-accent"));
  wrap.addEventListener("drop", async (e) => { e.preventDefault(); box.classList.remove("border-accent"); for (const f of Array.from((e as DragEvent).dataTransfer?.files || [])) pending.push(await uploadFile(f)); drawAttach(); });
  drawAttach();
  return wrap;
}

async function composerModelPopover(event: MouseEvent, threadRootId: number | null, current: ModelPolicy | null, onChange: (policy: ModelPolicy | null) => void): Promise<void> {
  const channel = S.channels.find((item) => item.id === S.channelId);
  const agent = channel?.agent;
  if (!agent) return;
  const personalMode = !S.me.is_admin || agent.kind === "skipper";
  const pop = h("div", { class: "card fixed z-50 w-[min(400px,calc(100vw-1.5rem))] space-y-3 p-4 shadow-2xl" });
  const width = Math.min(400, window.innerWidth - 24);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(12, Math.min(event.clientX - width + 24, window.innerWidth - width - 12))}px`;
  pop.style.top = `${Math.max(12, Math.min(event.clientY - 280, window.innerHeight - 360))}px`;
  const close = (): void => { pop.remove(); document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", keydown); };
  const outside = (next: MouseEvent): void => { if (!pop.contains(next.target as Node)) close(); };
  const keydown = (next: KeyboardEvent): void => { if (next.key === "Escape") close(); };
  const provider = h("select", { class: "field text-xs" }, h("option", { value: "" }, "Inherit channel provider")) as HTMLSelectElement;
  const model = h("select", { class: "field text-xs" }, h("option", { value: "" }, "Inherit channel model")) as HTMLSelectElement;
  const status = h("p", { class: "min-h-5 text-xs text-muted" }, personalMode ? "This choice follows your 1Helm account." : threadRootId ? "Changes persist for this thread." : "Your choice will be saved when this new thread is sent.");
  let sequence = 0;
  let routedModels: RoutingModel[] = [];
  const providerKey = (item: RoutingModel): string => item.kind === "route" ? "routes" : String(item.providerType || item.providerName || "models");
  const load = async (): Promise<void> => {
    const active = ++sequence;
    clear(model); model.disabled = true;
    model.append(h("option", { value: "" }, provider.value ? "Choose a model" : "Inherit channel model"));
    if (!provider.value) { model.disabled = false; return; }
    try {
      if (!routedModels.length) routedModels = (await api<{ models: RoutingModel[] }>("/api/workspace/model-policy")).models;
      const models = routedModels.filter((item) => providerKey(item) === provider.value);
      if (active !== sequence) return;
      clear(model); model.append(h("option", { value: "" }, "Choose a model"));
      for (const item of models) model.append(h("option", { value: item.id, selected: item.id === current?.model }, item.name || item.id));
      status.textContent = `${models.length} models available.`;
    } catch (error) { status.textContent = (error as Error).message; }
    finally { if (active === sequence) model.disabled = false; }
  };
  provider.addEventListener("change", () => { void load(); });
  const save = async (): Promise<void> => {
    if (!provider.value || !model.value) { status.textContent = "Choose both a provider and a model, or use Inherit."; return; }
    let policy: ModelPolicy = { provider_id: agent.provider_id, provider_name: provider.selectedOptions[0]?.textContent || null, provider_kind: "routing", model: model.value, overridden: true, editable: true };
    try {
      if (personalMode) await api("/api/workspace/model-policy", { method: "PATCH", body: { model: policy.model, personal: true } });
      else if (threadRootId) policy = (await api<{ policy: ModelPolicy }>(`/api/messages/${threadRootId}/model-policy`, { body: { provider_id: policy.provider_id, model: policy.model } })).policy;
      onChange(policy); close();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  const inherit = async (): Promise<void> => {
    try {
      if (personalMode) {
        const result = await api<{ model: string }>("/api/workspace/model-policy", { method: "PATCH", body: { model: "", personal: true } });
        onChange({ provider_id: agent.provider_id, provider_name: agent.provider_name, provider_kind: "routing", model: result.model, overridden: false, editable: true });
      } else if (threadRootId) {
        const result = await api<{ policy: ModelPolicy }>(`/api/messages/${threadRootId}/model-policy`, { body: { provider_id: null, model: null } });
        onChange(result.policy);
      } else onChange(null);
      close();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  pop.append(
    h("div", { class: "flex items-start justify-between gap-3" }, h("div", {}, h("div", { class: "font-semibold text-fg" }, personalMode ? "My model" : "Thread model"), h("div", { class: "mt-0.5 text-xs text-muted" }, personalMode ? "Uses your personal providers plus accounts explicitly shared with the workspace." : `Future replies from @${agent.name} use this choice.`)), h("button", { class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close", onclick: close }, icon("x", 16))),
    h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Provider", provider),
    h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Model", model),
    status,
    h("div", { class: "flex justify-end gap-2" }, h("button", { class: "btn-subtle min-h-9 px-3 text-xs", onclick: () => { void inherit(); } }, "Use workspace default"), h("button", { class: "btn-primary min-h-9 px-3 text-xs", onclick: () => { void save(); } }, personalMode ? "Use for me" : "Use for thread")));
  document.body.append(pop);
  setTimeout(() => { document.addEventListener("mousedown", outside); document.addEventListener("keydown", keydown); }, 0);
  void api<{ models: RoutingModel[] }>("/api/workspace/model-policy").then(({ models }) => {
    routedModels = models; const groups = new Map<string, string>();
    for (const item of models) groups.set(providerKey(item), item.kind === "route" ? "Named routes" : String(item.providerName || item.providerType || "Provider"));
    const selected = models.find((item) => item.id === current?.model);
    provider.append(...[...groups].map(([value, label]) => h("option", { value, selected: selected ? providerKey(selected) === value : false }, label)));
    if (selected) void load();
  }).catch((error) => { status.textContent = (error as Error).message; });
}

// ---------------- @mention / #channel autocomplete ----------------
type ComposerSuggest = { kind: "agent" | "human" | "channel"; token: string; label: string; detail: string };

const currentAtMention = (input: HTMLTextAreaElement): string | null => {
  const m = input.value.slice(0, input.selectionStart).match(/(^|[\s([{])@([a-zA-Z0-9_.-]*)$/);
  return m ? m[2].toLowerCase() : null;
};
const currentHashMention = (input: HTMLTextAreaElement): string | null => {
  // Do not treat Markdown headings ("# Title") as channel mentions: require a
  // word-boundary-ish left context, not start-of-line alone with a space after.
  const m = input.value.slice(0, input.selectionStart).match(/(^|[\s([{])#([a-zA-Z0-9_.-]*)$/);
  return m ? m[2].toLowerCase() : null;
};

function composerAutocomplete(input: HTMLTextAreaElement, box: HTMLElement): void {
  const at = currentAtMention(input);
  if (at != null) {
    const channel = S.channels.find((item) => item.id === S.channelId);
    const resident = channel?.agent?.bot_id ? S.bots.find((bot) => bot.id === channel.agent!.bot_id) : undefined;
    const skipper = S.bots.find((bot) => bot.agent_kind === "skipper");
    const agentCandidates = channel?.kind === "channel" ? [resident, skipper] : [];
    const agentMatches: ComposerSuggest[] = agentCandidates
      .filter((bot): bot is Bot => !!bot && bot.name.toLowerCase().startsWith(at))
      .map((bot) => ({ kind: "agent", token: bot.name, label: bot.name, detail: bot.agent_kind === "skipper" ? "Workspace Skipper" : bot.model || "Resident agent" }));
    const members = Array.isArray(channel?.members) ? channel.members : [];
    const humanMatches: ComposerSuggest[] = members
      .filter((user) => user.id !== S.me.id && (user.username.toLowerCase().startsWith(at) || user.display.toLowerCase().startsWith(at)))
      .slice(0, 6)
      .map((user) => ({ kind: "human", token: user.username, label: user.display || user.username, detail: `@${user.username}` }));
    return drawComposerSuggest(box, input, [...agentMatches, ...humanMatches].slice(0, 8), "People and agents", "agent");
  }
  const hash = currentHashMention(input);
  if (hash != null) {
    const matches: ComposerSuggest[] = channelLinks()
      .filter((channel) => channel.name.toLowerCase().startsWith(hash) || channel.slug.toLowerCase().startsWith(hash))
      .slice(0, 8)
      .map((channel) => ({ kind: "channel", token: channel.name, label: channel.name, detail: channel.slug !== channel.name ? channel.slug : "channel" }));
    return drawComposerSuggest(box, input, matches, "Channels", "channel");
  }
  box.classList.add("hidden");
}

function drawComposerSuggest(box: HTMLElement, input: HTMLTextAreaElement, matches: ComposerSuggest[], title: string, kind: "agent" | "channel"): void {
  if (!matches.length) { box.classList.add("hidden"); return; }
  clear(box); box.classList.remove("hidden");
  box.append(h("div", { class: "eyebrow px-3 pt-2.5 pb-1 text-faint" }, title));
  matches.forEach((item, i) => box.append(h("button", {
    class: `flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${i === 0 ? "bg-accent-soft" : "hover:bg-hover"}`,
    dataset: { kind: item.kind, token: item.token },
    onclick: () => applyComposerSuggest(input, item.kind, item.token, box),
  },
    item.kind === "agent" ? avatar(item.label, "bot", 6) : item.kind === "human" ? avatar(item.label, "user", 6) : h("span", { class: "grid h-6 w-6 place-items-center rounded bg-raised text-muted" }, icon("hash", 14)),
    h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate font-medium text-fg" }, kind === "channel" ? `#${item.label}` : item.label), h("span", { class: "block break-all text-[11px] leading-4 text-muted", title: item.detail }, item.detail)))));
}

function applyComposerSuggest(input: HTMLTextAreaElement, kind: "agent" | "human" | "channel", token: string, box: HTMLElement): void {
  const beforeCursor = input.value.slice(0, input.selectionStart);
  const after = input.value.slice(input.selectionStart);
  const replaced = kind !== "channel"
    ? beforeCursor.replace(/@[a-zA-Z0-9_.-]*$/, `@${token} `)
    : beforeCursor.replace(/#[a-zA-Z0-9_.-]*$/, `#${token} `);
  input.value = replaced + after;
  input.selectionStart = input.selectionEnd = replaced.length;
  box.classList.add("hidden");
  input.focus();
  input.dispatchEvent(new Event("input"));
}

function handleComposerSuggestKey(k: KeyboardEvent, box: HTMLElement, input: HTMLTextAreaElement): boolean {
  const items = Array.from(box.querySelectorAll("button")) as HTMLElement[];
  if (!items.length) return false;
  let idx = items.findIndex((b) => b.classList.contains("bg-accent-soft"));
  if (k.key === "ArrowDown") idx = (idx + 1) % items.length;
  else if (k.key === "ArrowUp") idx = (idx - 1 + items.length) % items.length;
  else if (k.key === "Enter" || k.key === "Tab") {
    const chosen = items[Math.max(0, idx)];
    applyComposerSuggest(input, (chosen.dataset.kind as "agent" | "channel") || "agent", chosen.dataset.token!, box);
    return true;
  } else return false;
  items.forEach((b, i) => b.classList.toggle("bg-accent-soft", i === idx));
  return true;
}

// ---------------- bot add prompt ----------------
// Native 1Helm: an ordinary channel has exactly one resident agent plus workspace-wide Skipper.
// A mention of an unknown/legacy bot is not wired into the channel; surface native guidance instead.
function botPrompt(e: { botId: number; botName: string; channelId: number; triggerId: number; threadRootId: number; fresh: boolean }): void {
  const c = S.channels.find((x) => x.id === e.channelId);
  const toast = h("div", { class: "card app-toast fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-1.5rem)] max-w-[440px] -translate-x-1/2 items-center gap-3 p-4 shadow-2xl" },
    avatar(e.botName, "bot", 10),
    h("div", { class: "min-w-0 flex-1" }, h("div", { class: "text-sm text-fg" }, h("strong", {}, "@" + e.botName), " isn't a resident of ", h("strong", {}, "#" + (c?.name || "channel")), "."), h("div", { class: "text-xs text-muted" }, "This channel's resident agent responds to its own @mention; call @skipper for anything outside its world.")),
    h("div", { class: "flex shrink-0 gap-2" }, h("button", { class: "btn-ghost min-h-11 px-3 text-sm sm:min-h-0", onclick: () => toast.remove() }, "Dismiss")));
  document.body.append(toast);
  setTimeout(() => toast.remove(), 12000);
}

function mentionConfirmation(event: { channelId: number; messageId: number; threadRootId: number; botId: number; botName: string }): void {
  if (event.channelId !== S.channelId) return;
  const toast = h("div", { class: "card app-toast fixed bottom-6 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[520px] -translate-x-1/2 p-4 shadow-2xl" },
    h("div", { class: "font-semibold text-fg" }, `Did you mean to tag @${event.botName}?`),
    h("p", { class: "mt-1 text-sm leading-5 text-muted" }, "This thread now has more than one participant, so agents wait for an explicit mention."),
    h("div", { class: "mt-3 flex justify-end gap-2" },
      h("button", { class: "btn-subtle min-h-10 px-3 text-sm", onclick: async () => { await api(`/api/messages/${event.messageId}/mention-confirmation`, { body: { confirm: false, botId: event.botId } }); toast.remove(); } }, "No, don't ask again"),
      h("button", { class: "btn-primary min-h-10 px-3 text-sm", onclick: async () => { await api(`/api/messages/${event.messageId}/mention-confirmation`, { body: { confirm: true, botId: event.botId } }); toast.remove(); } }, `Yes, tag @${event.botName}`)));
  document.body.append(toast);
}

function memberAddConfirmation(event: { channelId: number; messageId: number; userId: number; username: string; display: string }): void {
  if (event.channelId !== S.channelId || !S.me.is_admin) return;
  const channel = S.channels.find((item) => item.id === event.channelId);
  const toast = h("div", { class: "card app-toast fixed bottom-6 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[520px] -translate-x-1/2 p-4 shadow-2xl" },
    h("div", { class: "font-semibold text-fg" }, `Add @${event.username}?`),
    h("p", { class: "mt-1 text-sm leading-5 text-muted" }, `${event.display || `@${event.username}`} will be able to see and participate in #${channel?.name || "this channel"}.`),
    h("div", { class: "mt-3 flex justify-end gap-2" },
      h("button", { class: "btn-subtle min-h-10 px-3 text-sm", onclick: () => toast.remove() }, "Cancel"),
      h("button", { class: "btn-primary min-h-10 px-3 text-sm", onclick: async () => {
        await api(`/api/channels/${event.channelId}/members/${event.userId}`, { body: { messageId: event.messageId } });
        toast.remove();
      } }, `Add @${event.username}`)));
  document.body.append(toast);
}

// ---------------- shared atoms ----------------
function appModal(title: string, body: string | HTMLElement, buttons: { label: string; primary?: boolean; danger?: boolean; onClick: () => void }[]): void {
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-6", onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); } },
    h("section", { class: "card mobile-sheet w-full max-w-md overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl" },
      h("div", { class: "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6" },
        h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, title),
        h("button", { class: "grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover sm:h-8 sm:w-8", "aria-label": "Close", onclick: () => overlay.remove() }, icon("x"))),
      h("div", { class: "p-4 sm:p-6" }, typeof body === "string" ? h("p", { class: "text-sm leading-6 text-muted" }, body) : body),
      h("div", { class: "flex items-center justify-end gap-2 border-t border-line px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" },
        ...buttons.map((btn) => h("button", {
          class: btn.primary ? "btn-primary min-h-11 px-4 text-sm sm:min-h-0" : btn.danger ? "btn-danger min-h-11 px-4 text-sm sm:min-h-0" : "btn-ghost min-h-11 px-4 text-sm sm:min-h-0",
          onclick: () => { btn.onClick(); overlay.remove(); },
        }, btn.label)))));
  document.body.append(overlay);
}

export function appAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    appModal("Notice", message, [{ label: "OK", primary: true, onClick: () => resolve() }]);
  });
}

export function appConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    appModal("Confirm", message, [
      { label: "Cancel", onClick: () => resolve(false) },
      { label: "Confirm", primary: true, onClick: () => resolve(true) },
    ]);
  });
}

export function appPrompt(message: string | Node, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { class: "field", value: defaultValue, autocomplete: "off" }) as HTMLInputElement;
    const body = typeof message === "string"
      ? h("p", { class: "text-sm leading-6 text-muted", html: message.replace(/\*\*([^*]+)\*\*/g, "<strong class=\"font-semibold text-fg\">$1</strong>").replace(/\n/g, "<br>") })
      : message;
    appModal("Input", h("div", { class: "space-y-3" }, body, input), [
      { label: "Cancel", onClick: () => resolve(null) },
      { label: "OK", primary: true, onClick: () => resolve(input.value) },
    ]);
    input.focus();
    input.select();
  });
}

export function avatar(name: string, kind: "user" | "bot" | "system", size = 8, avatarValue?: string): HTMLElement {
  const px = size * 4;
  const residentCharacter = /^agent:([1-9]):(#[0-9a-f]{6})$/i.exec(avatarValue || "");
  if (kind === "bot" && residentCharacter) {
    return h("span", {
      class: "identity-bot identity-solid relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md",
      style: `width:${px}px;height:${px}px;background:${residentCharacter[2]}`,
      title: name,
      "aria-label": name,
    }, h("img", {
      class: "h-full w-full object-contain",
      src: `/agent-avatars/agent-${residentCharacter[1]}.png`,
      alt: "",
      draggable: false,
    }));
  }
  // Custom or default image fills the whole plate — never layer initials on top of it.
  if (avatarValue?.startsWith("data:image/") || avatarValue?.startsWith("/")) {
    return h("img", {
      class: `${kind === "bot" ? "identity-bot" : "identity-user"} identity-photo rounded-md object-cover`,
      style: `width:${px}px;height:${px}px`,
      src: avatarValue,
      alt: name,
      title: name,
    });
  }
  if (kind === "bot") {
    if (avatarValue?.startsWith("color:")) {
      const hex = avatarValue.slice(6);
      // Solid color tile is the entire avatar — no monogram over a muddy field.
      return h("div", {
        class: "identity-bot identity-solid rounded-md",
        style: `width:${px}px;height:${px}px;background:${hex}`,
        title: name,
        "aria-label": name,
      });
    }
    return h("div", {
      class: "identity-bot rounded-md",
      style: `width:${px}px;height:${px}px`,
      title: name,
      "aria-label": name,
    }, helmMark(Math.max(12, px * .52)));
  }
  // People: high-contrast solid swatch from seed, monogram only when no photo.
  const bg = color(name);
  return h("div", {
    class: "identity-user identity-initials rounded-lg",
    style: `width:${px}px;height:${px}px;font-size:${Math.max(10, px / 2.5)}px;background:${bg};color:#f7f4ec;border-color:transparent`,
    title: name,
    "aria-label": name,
  }, initials(name));
}
export function pickList(title: string, items: { id: number; label: string }[], onPick: (id: number) => void): void {
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/45 p-0 sm:place-items-center sm:p-6", onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); } },
    h("div", { class: "card mobile-sheet max-h-[85dvh] w-full overflow-y-auto rounded-b-none p-2 shadow-2xl sm:max-h-[70vh] sm:max-w-96 sm:rounded-xl" },
      h("div", { class: "flex items-center justify-between gap-2 px-2 py-2" },
        h("div", { class: "font-semibold text-fg" }, title),
        h("button", { class: "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-hover sm:h-8 sm:w-8", "aria-label": "Close", onclick: () => overlay.remove() }, icon("x", 18))),
      ...items.map((it) => h("button", { class: "block min-h-12 w-full rounded-lg px-3 py-3 text-left text-sm text-fg hover:bg-hover sm:min-h-11 sm:py-2", onclick: () => { overlay.remove(); onPick(it.id); } }, it.label))));
  document.body.append(overlay);
}
export const renderSidebar = (): void => {
  if (!S.channels) return;
  document.querySelectorAll<HTMLElement>("[data-sidebar]").forEach((s) => s.replaceWith(sidebar(s.dataset.sidebar === "mobile")));
};
const fmtSize = (n: number): string => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

let altTapStarted = 0;
let altTapOnly = false;
window.addEventListener("keydown", (event) => {
  if (event.key === "Alt" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    altTapStarted = performance.now();
    altTapOnly = true;
    return;
  }
  if (altTapOnly) altTapOnly = false;
  if (event.key !== "Escape") return;
  if (S.mobileMenuOpen) { closeMobileMenu(); return; }
  // Close terminal first when both are open (thread stays).
  if (S.terminalOpen && S.threadRoot) { closeDockedTerminal(); return; }
  if (S.terminalOpen) { closeDockedTerminal(); return; }
  if (S.notesOpen) { closeDockedNotes(); return; }
  if (S.threadRoot) closeThread();
});
window.addEventListener("keyup", (event) => {
  if (event.key !== "Alt") return;
  const isSingleTap = altTapOnly && performance.now() - altTapStarted < 800;
  altTapOnly = false;
  if (!isSingleTap || !document.hasFocus()) return;
  const input = activeComposerInput();
  if (input && !input.disabled && input.offsetParent !== null) void toggleSpeechToText(input);
});
window.addEventListener("blur", () => { altTapOnly = false; });
window.matchMedia("(min-width: 768px)").addEventListener("change", (event) => { if (event.matches && S.mobileMenuOpen) closeMobileMenu(); });

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      // Pick up a new SW when the host ships a build — no manual hard refresh.
      void reg.update().catch(() => {});
      setInterval(() => { void reg.update().catch(() => {}); }, 60 * 60_000);
      // A newly activated worker controls future navigations. Never force this
      // live document to reload: that can destroy an editor draft or pull the
      // Captain out of the note/thread they are using.
    })
    .catch((error) => console.warn("1Helm service worker registration failed", error));
}
if (document.readyState === "complete") registerServiceWorker();
else window.addEventListener("load", registerServiceWorker, { once: true });

boot();
