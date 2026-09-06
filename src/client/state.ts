import type { Bot, Channel, Computer, Message, Provider, SilentFollowupActivity, ThreadFollowup, ThreadUsage, User, Workspace } from "./api.ts";

export type AppChannelView = "chat" | "texts" | "board" | "workflows" | "threads" | "cowork" | "notes" | "files" | "terminal" | "memory" | "activity" | "settings";
export type ChannelUiView = {
  terminalOpen: boolean;
  notesOpen: boolean;
  serversListOpen: boolean;
  preferredComputerId: number | null;
  threadRootId: number | null;
};
type State = {
  me: User; users: User[]; channels: Channel[]; bots: Bot[]; computers: Computer[]; providers: Provider[];
  workspace: Workspace; channelId: number; channelBots: Bot[]; messages: Message[];
  threadRoot: Message | null; threadReplies: Message[]; view: AppChannelView;
  threadUsage: ThreadUsage; threadFollowup: ThreadFollowup | null; threadFollowupActivity: SilentFollowupActivity[]; threadStopContinuation: boolean;
  mobileMenuOpen: boolean; preferredTerminalComputerId: number | null;
  terminalOpen: boolean; notesOpen: boolean; serversListOpen: boolean;
  channelViews: Record<number, ChannelUiView>;
  globalThreadsOpen: boolean; globalThreadsUnreadOnly: boolean;
  groupUnreadChannelsFirst: boolean; desktopSidebarCollapsed: boolean;
  photonConfigured: boolean; selectedTextConversationId: number | null;
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
  desktopSidebarCollapsed: false,
  photonConfigured: false,
  selectedTextConversationId: null,
  threadUsage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, model_calls: 0 },
  threadFollowup: null,
  threadFollowupActivity: [] as SilentFollowupActivity[],
  threadStopContinuation: false,
} as State;

export type ThreadSnapshot = {
  root: Message; replies: Message[]; followup?: ThreadFollowup | null;
  followup_activity?: SilentFollowupActivity[]; usage?: ThreadUsage; stop_requested?: boolean;
};

export function applyThreadSnapshot(data: ThreadSnapshot): void {
  S.threadRoot = data.root; S.threadReplies = data.replies;
  S.threadFollowup = data.followup || null; S.threadFollowupActivity = data.followup_activity || [];
  S.threadStopContinuation = Boolean(data.stop_requested);
  S.threadUsage = {
    input_tokens: Math.max(0, Number(data.usage?.input_tokens || 0)),
    output_tokens: Math.max(0, Number(data.usage?.output_tokens || 0)),
    cached_input_tokens: Math.max(0, Number(data.usage?.cached_input_tokens || 0)),
    model_calls: Math.max(0, Number(data.usage?.model_calls || 0)),
  };
}

type StateRequest = <T>(path: string) => Promise<T>;
/** Pull authoritative visible data without painting over navigation that occurs mid-request. */
export async function resyncVisibleState(request: StateRequest, loadWorkspace: () => Promise<void>, paint: () => void): Promise<void> {
  const previousId = S.channelId, previousView = S.view, previousThreadId = S.threadRoot?.id ?? null;
  await loadWorkspace();
  if (!previousId || !S.channels.some((channel) => channel.id === previousId)) { paint(); return; }
  const [channelData, threadData] = await Promise.all([
    previousView === "chat" ? request<{ messages: Message[]; bots: Bot[] }>(`/api/channels/${previousId}/messages?progress=summary`) : null,
    previousThreadId ? request<ThreadSnapshot>(`/api/messages/${previousThreadId}/thread?progress=summary`) : null,
  ]);
  if (S.channelId !== previousId || S.view !== previousView || (S.threadRoot?.id ?? null) !== previousThreadId) return;
  if (channelData) { S.messages = channelData.messages; S.channelBots = channelData.bots; }
  if (threadData) applyThreadSnapshot(threadData);
  paint();
}

export const defaultChannelView = (): ChannelUiView => ({
  terminalOpen: false,
  notesOpen: false,
  serversListOpen: false,
  preferredComputerId: null,
  threadRootId: null,
});
