import { createHash } from "node:crypto";
type Row = Record<string, unknown>;
type Query = (sql: string, ...params: unknown[]) => Row[];
type QueryOne = (sql: string, ...params: unknown[]) => Row | undefined;

type ViewerRules = {
  canManageChannel: (user: Row, channelId: number) => boolean;
  channelUnreadCount: (userId: number, channelId: number, lastRead: number) => number;
  detailedAgent: (channelId: number) => unknown;
  computer: (channelId: number) => unknown;
  agentForChannel: (channelId: number) => Row | undefined;
  resolvedModel: (botId: number, channelId: number) => string;
  q: Query;
  q1: QueryOne;
};

const imageVersion = (value: unknown): string => createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
export const userAvatarUrl = (row: Row): string => String(row.avatar || "").startsWith("data:image/")
  ? `/api/users/${Number(row.id)}/avatar?v=${imageVersion(row.avatar)}`
  : String(row.avatar || "");
const botAvatarUrl = (row: Row): string => String(row.avatar || "").startsWith("data:image/")
  ? `/api/bots/${Number(row.id)}/avatar?v=${imageVersion(row.avatar)}`
  : String(row.avatar || "");

export const publicUser = (row: Row): Record<string, unknown> => ({
  id: row.id, username: row.username, display: row.display, is_admin: Boolean(row.is_admin),
  description: String(row.description || ""), job_title: String(row.job_title || ""),
  avatar: userAvatarUrl(row), tour_complete: Boolean(row.tour_complete),
});

const channelFavorite = (userId: number, channelId: number, rules: ViewerRules): boolean => {
  const value = rules.q1("SELECT value FROM user_ui_state WHERE user_id=? AND key=?", userId, `channel_favorite:${channelId}`)?.value;
  if (value == null) return false;
  try { return JSON.parse(String(value)) === true; } catch { return String(value) === "true"; }
};
const members = (channelId: number, detailed: boolean, rules: ViewerRules): Record<string, unknown>[] => rules.q(`SELECT u.id,u.username,u.display${detailed ? ",u.avatar" : ""}
  FROM members m JOIN users u ON u.id=m.user_id WHERE m.channel_id=? ORDER BY lower(u.display),lower(u.username),u.id`, channelId)
  .map((member) => ({ id: Number(member.id), username: String(member.username), display: String(member.display), avatar: detailed ? userAvatarUrl(member) : "" }));

function agentSummary(channelId: number, rules: ViewerRules): Record<string, unknown> | null {
  const agent = rules.agentForChannel(channelId);
  if (!agent) return null;
  const bot = agent.bot_id ? rules.q1("SELECT id,name,model,avatar,provider_id FROM bots WHERE id=?", agent.bot_id) : undefined;
  const provider = bot?.provider_id ? rules.q1("SELECT id,name,kind FROM providers WHERE id=?", bot.provider_id) : undefined;
  return {
    id: agent.id, bot_id: agent.bot_id, kind: agent.kind, name: agent.name, display_name: agent.display_name,
    status: agent.status, purpose: agent.purpose,
    model: bot ? String(rules.resolvedModel(Number(bot.id), channelId) || bot.model || "") : "",
    provider_id: provider?.id || null, provider_name: provider?.name || null, provider_kind: provider?.kind || null,
    capabilities: [], skills: [], runtime: bot ? { id: bot.id, name: bot.name, model: bot.model, avatar: botAvatarUrl(bot) } : null,
  };
}

export function channelMetaView(channel: Row, viewer: Row | null | undefined, detailed: boolean, rules: ViewerRules): Record<string, unknown> {
  let name = String(channel.name);
  if (channel.kind === "dm" && viewer) {
    const other = rules.q1("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.channel_id=? AND m.user_id<>?", channel.id, viewer.id);
    name = other ? String(other.display) : "Direct message";
  }
  return {
    id: channel.id, name, slug: channel.slug || String(channel.id), kind: channel.kind, topic: channel.topic,
    purpose: channel.purpose || channel.topic, status: channel.status || "active",
    call_skipper_without_confirmation: channel.call_skipper_without_confirmation == null || Boolean(channel.call_skipper_without_confirmation),
    agent: channel.kind === "channel" ? (detailed ? rules.detailedAgent(Number(channel.id)) : agentSummary(Number(channel.id), rules)) : null,
    ...(detailed ? { computer: channel.kind === "channel" ? rules.computer(Number(channel.id)) : null } : {}),
    personal_main: channel.kind === "channel" && channel.name === "main" && channel.personal_main_owner_id != null, detailed,
    ...(viewer ? { can_manage: rules.canManageChannel(viewer, Number(channel.id)), favorite: channelFavorite(Number(viewer.id), Number(channel.id), rules), members: members(Number(channel.id), detailed, rules) } : {}),
  };
}

export function channelView(user: Row, channel: Row, detailed: boolean, rules: ViewerRules): Record<string, unknown> {
  const lastRead = Number(rules.q1("SELECT last_read FROM members WHERE channel_id=? AND user_id=?", channel.id, user.id)?.last_read || 0);
  return { ...channelMetaView(channel, user, detailed, rules), unread: rules.channelUnreadCount(Number(user.id), Number(channel.id), lastRead) };
}
