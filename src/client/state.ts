import type { Bot, Channel, Computer, Message, Provider, ThreadFollowup, ThreadUsage, User, Workspace } from "./api.ts";

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
  threadUsage: ThreadUsage; threadFollowup: ThreadFollowup | null;
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
  threadUsage: { input_tokens: 0, output_tokens: 0 },
  threadFollowup: null,
} as State;

export const defaultChannelView = (): ChannelUiView => ({
  terminalOpen: false,
  notesOpen: false,
  serversListOpen: false,
  preferredComputerId: null,
  threadRootId: null,
});
