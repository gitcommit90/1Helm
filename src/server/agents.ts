import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { DATA_DIR, UPLOAD_DIR, now, q, q1, run, tx, type Row } from "./db.ts";
import { botView, resolveModel } from "./store.ts";
import { ensureAgentMemory, rememberForAgent } from "./memory.ts";
import { listSkills, provisionInitialSkills, provisionSkill, skillsForAgent, templateForSlug } from "./skills.ts";
import { archiveChannelComputer, deleteChannelComputer, ensureChannelComputerRecord, markWorkspaceDirty, provisionChannelComputer, restoreChannelComputer } from "./channel-computers.ts";

const CHANNELS_DIR = join(DATA_DIR, "channels");
const WORLD_DIRS = ["workspace", "files", "state", "memory", "profile"];
const MEMORY_KINDS = new Set(["summary", "decision", "fact", "preference", "artifact_ref"]);
const AGENT_COLORS = ["#C8552F", "#2166B8", "#2E7D4F", "#8A6B7C", "#A67C52", "#4F6D7A", "#7A6A4F", "#64748B"];
const randomAgentAvatar = (): string => {
  const used = new Set(q(`SELECT b.avatar FROM bots b JOIN agents a ON a.bot_id=b.id
    WHERE a.kind='channel' AND a.status<>'deleted' AND b.avatar LIKE 'color:#%'`)
    .map((row) => String(row.avatar).slice(6).toUpperCase()));
  const available = AGENT_COLORS.filter((color) => !used.has(color.toUpperCase()));
  const palette = available.length ? available : AGENT_COLORS;
  return `color:${palette[randomBytes(1)[0] % palette.length]}`;
};

export type ProvisionedChannel = {
  channelId: number;
  agentId: number;
  botId: number;
  announcementId: number;
  created: boolean;
};

export type ProvisionedChannelComputer = ProvisionedChannel & { computerReady: boolean; computerError?: string };

export const normalizeChannelName = (value: string): string => value.trim().toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
export const channelSlug = (value: string): string => value.trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

export const channelRoot = (channelId: number): string => join(CHANNELS_DIR, String(channelId));
export const channelWorkspace = (channelId: number): string => join(channelRoot(channelId), "workspace");

export function ensureChannelWorkspace(channelId: number): string {
  const channel = q1("SELECT id,name,personal_main_owner_id FROM channels WHERE id=? AND status<>'deleted'", channelId);
  if (!channel) throw new Error("Channel workspace not found.");
  const root = channelRoot(channelId);
  for (const dir of WORLD_DIRS) mkdirSync(join(root, dir), { recursive: true });
  run("INSERT OR IGNORE INTO channel_workspaces (channel_id, root_ref, created) VALUES (?,?,?)", channelId, `channels/${channelId}`, now());
  const profile = q1(`SELECT a.id, a.kind, a.name, a.display_name, a.status, p.purpose, p.instructions, p.memory_namespace, p.capability_policy
    FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id
    LEFT JOIN agent_profiles p ON p.agent_id=a.id
    WHERE ac.channel_id=? OR (a.kind='skipper' AND EXISTS (
      SELECT 1 FROM channels c WHERE c.id=? AND c.kind='channel' AND c.name='main' AND c.status<>'deleted'))
    ORDER BY a.kind='skipper' DESC LIMIT 1`, channelId, channelId);
  if (profile) {
    const profilePath = join(root, "profile", "agent.json");
    const content = JSON.stringify(profile, null, 2);
    if (!existsSync(profilePath) || readFileSync(profilePath, "utf8") !== content) writeFileSync(profilePath, content);
  }
  return root;
}

function defaultPolicy(): { providerId: number | null; model: string } {
  const workspace = q1("SELECT default_provider_id, default_model FROM workspace WHERE id=1");
  if (workspace?.default_provider_id) return { providerId: Number(workspace.default_provider_id), model: String(workspace.default_model || "") };
  const skipper = q1("SELECT b.provider_id, b.model FROM bots b JOIN agents a ON a.bot_id=b.id WHERE a.kind='skipper' AND a.status<>'deleted' LIMIT 1");
  if (skipper) return { providerId: skipper.provider_id ? Number(skipper.provider_id) : null, model: String(skipper.model || "") };
  const provider = q1("SELECT id FROM providers ORDER BY id LIMIT 1");
  return { providerId: provider ? Number(provider.id) : null, model: "" };
}

function availableAgentName(channelName: string): string {
  const base = `${channelName}-agent`.slice(0, 64);
  let name = base;
  for (let suffix = 2; q1("SELECT 1 FROM bots WHERE lower(name)=lower(?) UNION SELECT 1 FROM agents WHERE lower(name)=lower(?) AND status<>'deleted' LIMIT 1", name, name); suffix++) {
    name = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}-${suffix}`;
  }
  return name;
}

const agentInstructions = (name: string, purpose: string, templateInstructions = ""): string => [
  `You are @${name}, the resident specialist for this channel.`,
  `The channel exists for: ${purpose}`,
  templateInstructions,
  "This channel's isolated Linux computer is your own machine. You have full ownership and autonomy inside it; it is not the Captain's computer and not a hypothetical workspace.",
  "Treat this channel, its threads, files, memory, tools, and /workspace as your normal world. For ordinary installs, downloads, setup, commands, configuration, and file operations inside your machine, act immediately without asking the user for permission.",
  "Infer the concrete task from the full thread and inspect your machine when useful. Do not ask the user to repeat context or choose between harmless implementation details you can resolve yourself.",
  "Work directly in /workspace when creating or changing files. Record durable decisions and useful facts with the remember tool. Verify the requested result before reporting completion.",
  "You know the workspace-wide skill catalog. Request a useful skill from Skipper when needed; grants are permanent. Propose a new skill after solving a reusable problem the catalog does not cover.",
  "When work needs host-level authority, another channel, a missing capability, another resident expert, or credentials, use call_skipper. Do not silently act outside this channel world.",
].join("\n");

export function updateChannelPurpose(channelId: number, purpose: string): void {
  const agent = q1(`SELECT a.id, a.bot_id, a.name FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=?`, channelId);
  if (!agent?.bot_id) throw new Error("Resident agent not found.");
  const instructions = agentInstructions(String(agent.name), purpose);
  tx(() => {
    run("UPDATE channels SET purpose=?, topic=? WHERE id=?", purpose, purpose, channelId);
    run("UPDATE agent_profiles SET purpose=?, instructions=?, updated=? WHERE agent_id=?", purpose, instructions, now(), agent.id);
    run("UPDATE bots SET prompt=? WHERE id=?", instructions, agent.bot_id);
    run("INSERT INTO channel_activity (channel_id, kind, summary, actor_type, created) VALUES (?,'profile','Channel purpose and resident instructions updated.','system',?)", channelId, now());
  });
  ensureChannelWorkspace(channelId);
}

/** Rename a channel (+ URL slug). Keeps resident @mention identity stable; only the channel label changes. */
export function renameChannel(channelId: number, nameInput: string): void {
  const channel = q1("SELECT id, name, kind, status FROM channels WHERE id=? AND status<>'deleted'", channelId);
  if (!channel || channel.kind !== "channel") throw new Error("Channel not found.");
  if (String(channel.name) === "main") throw new Error("#main cannot be renamed.");
  if (channel.status === "archived") throw new Error("Restore the channel before renaming.");
  const name = normalizeChannelName(nameInput);
  if (!name) throw new Error("Invalid channel name.");
  if (name === String(channel.name)) return;
  const clash = q1(
    "SELECT id FROM channels WHERE kind='channel' AND lower(name)=lower(?) AND status<>'deleted' AND id<>?",
    name,
    channelId,
  );
  if (clash) throw new Error("A channel with that name already exists.");
  let slug = channelSlug(name) || `channel-${channelId}`;
  for (let suffix = 2; q1("SELECT 1 FROM channels WHERE slug=? AND id<>? AND status<>'deleted'", slug, channelId); suffix++) {
    slug = `${channelSlug(name).slice(0, Math.max(1, 55 - String(suffix).length))}-${suffix}`;
  }
  tx(() => {
    run("UPDATE channels SET name=?, slug=? WHERE id=?", name, slug, channelId);
    run(
      "INSERT INTO channel_activity (channel_id, kind, summary, actor_type, created) VALUES (?,'lifecycle',?,?,?)",
      channelId,
      `Channel renamed to #${name}.`,
      "system",
      now(),
    );
  });
  ensureChannelWorkspace(channelId);
}

export function provisionChannel(opts: { name: string; purpose: string; userId: number; templateSlug?: string }): ProvisionedChannel {
  const name = normalizeChannelName(opts.name);
  const purpose = opts.purpose.trim();
  if (!name) throw new Error("Invalid channel name.");
  if (!purpose) throw new Error("Describe what this channel is for.");
  const existing = q1("SELECT id, created_by, purpose FROM channels WHERE kind='channel' AND lower(name)=lower(?) AND status<>'deleted'", name);
  if (existing) {
    const binding = q1("SELECT a.id agent_id, a.bot_id FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=?", existing.id);
    if (Number(existing.created_by) === opts.userId && String(existing.purpose) === purpose && binding) {
      const announcement = q1("SELECT id FROM messages WHERE channel_id=? AND bot_id=? AND parent_id IS NULL ORDER BY id LIMIT 1", existing.id, binding.bot_id);
      ensureChannelWorkspace(Number(existing.id));
      return { channelId: Number(existing.id), agentId: Number(binding.agent_id), botId: Number(binding.bot_id), announcementId: Number(announcement?.id || 0), created: false };
    }
    throw new Error("A channel with that name already exists.");
  }

  const defaults = defaultPolicy();
  const mentionName = availableAgentName(name);
  const template = templateForSlug(opts.templateSlug || "general") || templateForSlug("general");
  let channelId = 0;
  try {
    const result = tx(() => {
      channelId = run(
        "INSERT INTO channels (name, slug, kind, topic, purpose, status, created_by, created) VALUES (?,?,'channel',? ,?,'active',?,?)",
        name, channelSlug(name), purpose, purpose, opts.userId, now(),
      ).lastInsertRowid;
      run("INSERT OR IGNORE INTO members (channel_id, user_id) VALUES (?,?)", channelId, opts.userId);
      const instructions = agentInstructions(mentionName, purpose, String(template?.instructions || ""));
      const botId = run(
        "INSERT INTO bots (name, provider_id, model, prompt, avatar, base_url, api_key, created) VALUES (?,?,?,?,?,'','',?)",
        mentionName, defaults.providerId, defaults.model, instructions, randomAgentAvatar(), now(),
      ).lastInsertRowid;
      const agentId = run(
        "INSERT INTO agents (bot_id, kind, name, display_name, status, created) VALUES (?,'channel',?,?, 'ready', ?)",
        botId, mentionName, mentionName, now(),
      ).lastInsertRowid;
      run("INSERT INTO agent_channels (agent_id, channel_id, bound_at) VALUES (?,?,?)", agentId, channelId, now());
      run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", botId, channelId);
      run(
        "INSERT INTO agent_profiles (agent_id, purpose, instructions, workspace_ref, memory_namespace, capability_policy, updated) VALUES (?,?,?,?,?,?,?)",
        agentId, purpose, instructions, `channels/${channelId}`, `channel:${channelId}`, JSON.stringify({ boundary: "channel", cwd: "/workspace" }), now(),
      );
      for (const capability of ["shell", "files", "memory", "escalate"]) run("INSERT INTO agent_capabilities (agent_id, capability, created) VALUES (?,?,?)", agentId, capability, now());
      const skipper = q1("SELECT id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
      const skipperBot = q1("SELECT bot_id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
      if (skipperBot?.bot_id) run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", skipperBot.bot_id, channelId);
      provisionInitialSkills(agentId, String(template?.slug || "general"), purpose, skipper ? Number(skipper.id) : null);
      run("INSERT INTO channel_workspaces (channel_id, root_ref, created) VALUES (?,?,?)", channelId, `channels/${channelId}`, now());
      const root = channelRoot(channelId);
      for (const dir of WORLD_DIRS) mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, "profile", "agent.json"), JSON.stringify({ name: mentionName, purpose, template: template?.slug || "general", workspace: "/workspace", memory_namespace: `channel:${channelId}` }, null, 2));
      ensureChannelComputerRecord(channelId);
      markWorkspaceDirty(channelId, "*", "full");
      const announcement = [
        `I'm **@${mentionName}**, the resident agent for **#${name}**.`,
        "",
        purpose,
        "",
        "My workspace, files, threads, and memory are ready. Mention me in a thread to start working, or call **@skipper** when this channel needs something outside its world.",
      ].join("\n");
      const announcementId = run(
        "INSERT INTO messages (channel_id, parent_id, bot_id, body, created) VALUES (?,NULL,?,?,?)",
        channelId, botId, announcement, now(),
      ).lastInsertRowid;
      const threadId = run(
        "INSERT INTO threads (root_message_id, channel_id, status, title, summary, opened_at, updated_at) VALUES (?,?,'resolved','Resident agent ready',?,?,?)",
        announcementId, channelId, announcement, now(), now(),
      ).lastInsertRowid;
      run("INSERT INTO thread_summaries (thread_id, content, created) VALUES (?,?,?)", threadId, announcement, now());
      run("INSERT INTO channel_activity (channel_id, thread_id, kind, summary, actor_type, created) VALUES (?,?,'lifecycle',?,'system',?)", channelId, threadId, `Provisioned @${mentionName} and its channel world.`, now());
      return { channelId, agentId, botId, announcementId, created: true };
    });
    const createdAgent = agentForChannel(result.channelId);
    if (createdAgent) ensureAgentMemory(createdAgent);
    return result;
  } catch (error) {
    if (channelId) rmSync(channelRoot(channelId), { recursive: true, force: true });
    throw error;
  }
}

/** Product path: a channel is ready only after its computer is provisioned. */
export async function provisionChannelWithComputer(opts: { name: string; purpose: string; userId: number; templateSlug?: string }): Promise<ProvisionedChannelComputer> {
  const provisioned = provisionChannel(opts);
  try {
    await provisionChannelComputer(provisioned.channelId);
    return { ...provisioned, computerReady: true };
  } catch (error) {
    const message = (error as Error).message || "channel computer provisioning failed";
    run("UPDATE agents SET status='waiting' WHERE id=?", provisioned.agentId);
    run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'computer',?,'failed','skipper',?)", provisioned.channelId, `Channel computer provisioning needs attention: ${message}`.slice(0, 500), now());
    return { ...provisioned, computerReady: false, computerError: message };
  }
}

export function ensureSkipperAgent(botId: number, mainChannelId: number): number {
  const bot = q1("SELECT * FROM bots WHERE id=?", botId);
  if (!bot) throw new Error("Skipper runtime not found.");
  let agent = q1("SELECT * FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
  if (!agent) {
    const id = run("INSERT INTO agents (bot_id, kind, name, display_name, status, created) VALUES (?,'skipper','skipper','Skipper','ready',?)", botId, now()).lastInsertRowid;
    agent = q1("SELECT * FROM agents WHERE id=?", id)!;
  } else {
    run("UPDATE agents SET bot_id=?, name='skipper', display_name='Skipper', status='ready' WHERE id=?", botId, agent.id);
  }
  run(
    "INSERT INTO agent_profiles (agent_id, purpose, instructions, workspace_ref, memory_namespace, capability_policy, updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET purpose=excluded.purpose,instructions=excluded.instructions,updated=excluded.updated",
    agent.id, "Workspace-wide chief of staff and root operator", bot.prompt, "skipper", "workspace", JSON.stringify({ boundary: "workspace", authority: "host" }), now(),
  );
  for (const capability of ["shell", "files", "memory", "cross_channel", "host"]) run("INSERT OR IGNORE INTO agent_capabilities (agent_id, capability, created) VALUES (?,?,?)", agent.id, capability, now());
  // Gated skills are omitted from listSkills() until their backing provider
  // capability is enabled. Setup must not fail just because an optional
  // capability (for example Image Generation) is still locked.
  for (const skill of listSkills()) provisionSkill(Number(agent.id), String(skill.slug), Number(agent.id), "Skipper has the full workspace skill arsenal.");
  ensureChannelWorkspace(mainChannelId);
  ensureAgentMemory({ ...agent, channel_id: null });
  return Number(agent.id);
}

export function agentForBot(botId: number): Row | undefined {
  return q1(`SELECT a.*, ac.channel_id, p.purpose, p.instructions, p.workspace_ref, p.memory_namespace, p.capability_policy
    FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id LEFT JOIN agent_profiles p ON p.agent_id=a.id
    WHERE a.bot_id=? AND a.status<>'deleted'`, botId);
}

export function agentForChannel(channelId: number): Row | undefined {
  const main = q1("SELECT id FROM channels WHERE id=? AND kind='channel' AND name='main' AND status<>'deleted'", channelId);
  if (main) return q1(`SELECT a.*, NULL AS channel_id, p.purpose, p.instructions, p.workspace_ref, p.memory_namespace, p.capability_policy
    FROM agents a LEFT JOIN agent_profiles p ON p.agent_id=a.id WHERE a.kind='skipper' AND a.status<>'deleted' LIMIT 1`);
  return q1(`SELECT a.*, ac.channel_id, p.purpose, p.instructions, p.workspace_ref, p.memory_namespace, p.capability_policy
    FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id LEFT JOIN agent_profiles p ON p.agent_id=a.id
    WHERE ac.channel_id=? AND a.status<>'deleted'`, channelId);
}

export function agentViewForChannel(channelId: number): Record<string, unknown> | null {
  const agent = agentForChannel(channelId);
  if (!agent) return null;
  const bot = agent.bot_id ? q1("SELECT * FROM bots WHERE id=?", agent.bot_id) : undefined;
  const provider = bot?.provider_id ? q1("SELECT id, name, kind FROM providers WHERE id=?", bot.provider_id) : undefined;
  return {
    id: agent.id,
    bot_id: agent.bot_id,
    kind: agent.kind,
    name: agent.name,
    display_name: agent.display_name,
    status: agent.status,
    purpose: agent.purpose,
    model: bot ? resolveModel(Number(bot.id), channelId, null) : "",
    provider_id: provider?.id || null,
    provider_name: provider?.name || null,
    provider_kind: provider?.kind || null,
    capabilities: q("SELECT capability FROM agent_capabilities WHERE agent_id=? ORDER BY capability", agent.id).map((row) => String(row.capability)),
    skills: skillsForAgent(Number(agent.id)).map((skill) => ({ slug: skill.slug, name: skill.name, description: skill.description, category: skill.category, assigned: true })),
    runtime: bot ? botView(bot) : null,
  };
}

export function ensureThread(rootMessageId: number, channelId: number): number {
  const existing = q1("SELECT id FROM threads WHERE root_message_id=?", rootMessageId);
  if (existing) return Number(existing.id);
  const root = q1("SELECT body, created FROM messages WHERE id=? AND channel_id=? AND parent_id IS NULL", rootMessageId, channelId);
  if (!root) throw new Error("Thread root does not belong to this channel.");
  const title = String(root.body || "New session").split("\n")[0].slice(0, 100) || "New session";
  return run(
    "INSERT INTO threads (root_message_id, channel_id, status, title, summary, opened_at, updated_at) VALUES (?,?,'open',?,?,?,?)",
    rootMessageId, channelId, title, String(root.body || "").slice(0, 2000), root.created, now(),
  ).lastInsertRowid;
}

export function threadIdForRoot(rootMessageId: number, channelId?: number): number | null {
  const row = q1(channelId == null ? "SELECT id FROM threads WHERE root_message_id=?" : "SELECT id FROM threads WHERE root_message_id=? AND channel_id=?", rootMessageId, ...(channelId == null ? [] : [channelId]));
  return row ? Number(row.id) : null;
}

/** Rough cumulative model usage for a thread (provider-reported when available). */
export function threadUsage(threadId: number): { input_tokens: number; output_tokens: number } {
  const row = q1("SELECT input_tokens, output_tokens FROM threads WHERE id=?", threadId);
  return {
    input_tokens: Math.max(0, Number(row?.input_tokens || 0)),
    output_tokens: Math.max(0, Number(row?.output_tokens || 0)),
  };
}

export function threadUsageForRoot(rootMessageId: number, channelId?: number): { input_tokens: number; output_tokens: number } {
  const threadId = threadIdForRoot(rootMessageId, channelId);
  if (threadId == null) return { input_tokens: 0, output_tokens: 0 };
  return threadUsage(threadId);
}

/** Add one completion's usage onto the thread totals. Returns the new totals. */
export function addThreadUsage(threadId: number, inputTokens: number, outputTokens: number): { input_tokens: number; output_tokens: number } {
  const input = Math.max(0, Math.round(Number(inputTokens) || 0));
  const output = Math.max(0, Math.round(Number(outputTokens) || 0));
  if (input || output) {
    run(
      "UPDATE threads SET input_tokens=input_tokens+?, output_tokens=output_tokens+?, updated_at=? WHERE id=?",
      input, output, now(), threadId,
    );
  }
  return threadUsage(threadId);
}

export function refreshThreadSummary(rootMessageId: number): void {
  const root = q1("SELECT channel_id FROM messages WHERE id=? AND parent_id IS NULL", rootMessageId);
  if (!root) return;
  const channelId = Number(root.channel_id);
  const threadId = ensureThread(rootMessageId, channelId);
  const messages = q("SELECT id, body, user_id, bot_id FROM messages WHERE id=? OR parent_id=? ORDER BY id", rootMessageId, rootMessageId)
    .filter((message) => String(message.body || "").trim());
  const humans = messages.filter((message) => message.user_id != null);
  const agents = messages.filter((message) => message.bot_id != null);
  const compact = (value: unknown, limit: number): string => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const plainTitle = (value: unknown): string => compact(value, 240)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]+/g, "")
    .replace(/^[-+\d.)\s]+/, "")
    .replace(/\s+/g, " ").trim().slice(0, 100);
  const firstRequest = humans[0];
  const latestRequest = humans.at(-1);
  const latestOutcome = agents.at(-1);
  const thread = q1("SELECT status FROM threads WHERE id=?", threadId);
  const parts = [
    firstRequest ? `**Goal:** ${compact(firstRequest.body, 600)}` : "**Goal:** Establish this channel world.",
    latestRequest && latestRequest.id !== firstRequest?.id ? `**Latest request:** ${compact(latestRequest.body, 600)}` : "",
    latestOutcome ? `**Latest outcome:** ${compact(latestOutcome.body, 1400)}` : "**Latest outcome:** Waiting for the resident agent.",
    `**Session status:** ${String(thread?.status || "open")}.`,
  ].filter(Boolean);
  const summary = parts.join("\n\n").slice(0, 5000);
  const title = plainTitle(firstRequest?.body || messages[0]?.body || "New session");
  run("UPDATE threads SET title=?, summary=?, updated_at=? WHERE id=?", title || "New session", summary, now(), threadId);
  run("INSERT INTO thread_summaries (thread_id, content, created) VALUES (?,?,?)", threadId, summary, now());
}

export function recordMemory(opts: { channelId: number; threadId?: number | null; kind: string; content: string; sourceMessageId?: number | null; authorType: string; scope?: string }): number {
  const kind = MEMORY_KINDS.has(opts.kind) ? opts.kind : "fact";
  const content = opts.content.trim().slice(0, 10_000);
  if (!content) throw new Error("Memory content is required.");
  const author = ["human", "agent", "skipper", "system"].includes(opts.authorType) ? opts.authorType : "agent";
  const scope = ["thread", "channel", "workspace"].includes(opts.scope || "") ? opts.scope! : "channel";
  if (scope === "thread" && !opts.threadId) throw new Error("Thread-scoped memory requires a valid thread.");
  const id = run(
    "INSERT INTO memory_items (channel_id, thread_id, kind, content, source_message_id, author_type, scope, status, created) VALUES (?,?,?,?,?,?,?,'current',?)",
    opts.channelId, opts.threadId ?? null, kind, content, opts.sourceMessageId ?? null, author, scope, now(),
  ).lastInsertRowid;
  run("INSERT INTO channel_activity (channel_id, thread_id, kind, summary, actor_type, created) VALUES (?,?,'memory',?,?,?)", opts.channelId, opts.threadId ?? null, `Recorded ${kind}: ${content.slice(0, 180)}`, author, now());
  const owner = agentForChannel(opts.channelId);
  if (owner) rememberForAgent(owner, content, {
    source: opts.sourceMessageId ? `1helm:message:${opts.sourceMessageId}` : `1helm:memory:${id}`,
    importance: kind === "decision" || kind === "preference" ? 0.9 : 0.75,
    metadata: { canonical_memory_id: id, kind, thread_id: opts.threadId ?? null, scope, channel_id: opts.channelId },
    scope: "global",
    authorType: author,
    sessionId: opts.threadId ? `thread:${opts.threadId}` : `channel:${opts.channelId}`,
  });
  return id;
}

export function relevantMemory(channelId: number, currentThreadId: number | null): Row[] {
  return q(`SELECT m.*, t.root_message_id FROM memory_items m LEFT JOIN threads t ON t.id=m.thread_id
    WHERE m.status='current' AND m.kind<>'summary' AND (m.scope='workspace' OR (m.channel_id=? AND (m.scope='channel' OR m.thread_id=?)))
    ORDER BY CASE m.kind WHEN 'decision' THEN 0 WHEN 'preference' THEN 1 WHEN 'fact' THEN 2 ELSE 3 END, m.created DESC LIMIT 24`, channelId, currentThreadId ?? -1);
}

export type WorkspaceFile = { path: string; name: string; size: number; modified: number; kind: "file" | "directory" };

export function listWorkspaceFiles(channelId: number): WorkspaceFile[] {
  // Terminal / agent shell CWD is channel workspace/. Present that tree under
  // workspace/... (its absolute path in the agent world, and unambiguous next
  // to the sibling uploads tree, listed as files/...).
  const root = ensureChannelWorkspace(channelId);
  const files: WorkspaceFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        files.push({ path: rel, name: entry.name, size: 0, modified: statSync(full).mtimeMs, kind: "directory" });
        walk(full, rel);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        files.push({ path: rel, name: entry.name, size: stat.size, modified: stat.mtimeMs, kind: "file" });
      }
    }
  };
  walk(join(root, "workspace"), "workspace");
  walk(join(root, "files"), "files");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function resolveWorldFile(channelId: number, requested: string): string {
  const root = realpathSync(resolve(ensureChannelWorkspace(channelId)));
  // UI paths are relative to /workspace (agent shell). Map bare paths into workspace/.
  let rel = String(requested || "").replace(/^\/+/, "");
  if (rel.startsWith("workspace/")) rel = rel.slice("workspace/".length);
  const candidates = rel.startsWith("files/")
    ? [resolve(root, rel)]
    : [resolve(root, "workspace", rel), resolve(root, rel)];
  for (const lexicalTarget of candidates) {
    if (lexicalTarget !== root && !lexicalTarget.startsWith(root + sep)) continue;
    if (!existsSync(lexicalTarget) || !lstatSync(lexicalTarget).isFile()) continue;
    const target = realpathSync(lexicalTarget);
    if (target !== root && !target.startsWith(root + sep)) continue;
    return target;
  }
  throw new Error("File not found.");
}

export function syncWorkspaceArtifacts(channelId: number, threadId: number | null, createdBy = "agent"): WorkspaceFile[] {
  const files = listWorkspaceFiles(channelId);
  const paths = new Set(files.filter((entry) => entry.kind === "file").map((entry) => entry.path));
  for (const artifact of q("SELECT id, path FROM artifacts WHERE channel_id=?", channelId)) {
    if (!paths.has(String(artifact.path))) run("DELETE FROM artifacts WHERE id=?", artifact.id);
  }
  for (const file of files.filter((entry) => entry.kind === "file")) {
    run(`INSERT INTO artifacts (channel_id, thread_id, path, kind, created_by, size, modified, created) VALUES (?,?,?,'file',?,?,?,?)
      ON CONFLICT(channel_id,path) DO UPDATE SET thread_id=COALESCE(excluded.thread_id,artifacts.thread_id),size=excluded.size,modified=excluded.modified`,
      channelId, threadId, file.path, createdBy, file.size, file.modified, now());
  }
  return files;
}

export function importAttachment(channelId: number, threadId: number | null, token: string, name: string, createdBy: string): string | null {
  const source = join(UPLOAD_DIR, token);
  if (!existsSync(source)) return null;
  const safe = basename(name).replace(/[^a-zA-Z0-9._ -]+/g, "-") || "file";
  const filesDir = join(ensureChannelWorkspace(channelId), "files");
  let target = join(filesDir, safe);
  for (let suffix = 2; existsSync(target); suffix++) {
    const dot = safe.lastIndexOf(".");
    target = join(filesDir, dot > 0 ? `${safe.slice(0, dot)}-${suffix}${safe.slice(dot)}` : `${safe}-${suffix}`);
  }
  copyFileSync(source, target);
  const rel = relative(channelRoot(channelId), target).split(sep).join("/");
  const stat = statSync(target);
  run("INSERT INTO artifacts (channel_id, thread_id, path, kind, created_by, size, modified, created) VALUES (?,?,?,'upload',?,?,?,?)", channelId, threadId, rel, createdBy, stat.size, stat.mtimeMs, now());
  markWorkspaceDirty(channelId, rel, "upsert");
  return rel;
}

const ATTACH_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".zip": "application/zip",
};

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return ATTACH_MIME[lower.slice(dot)] || "application/octet-stream";
}

/**
 * Resolve a path the agent thinks of as under /workspace into a real host file.
 *
 * Reality on this host: run_command CWD is channel …/channels/<id>/workspace, but agents
 * often write absolute `/workspace/...`, which hits a separate host tree at /workspace
 * (not the channel world). Accept both, then prefer channel-local copies when present.
 */
export function resolveAgentFilePath(channelId: number, requestedPath: string): string {
  const raw = String(requestedPath || "").trim();
  if (!raw) throw new Error("File not found.");

  const stripWorkspacePrefix = (value: string): string => {
    let v = value.trim();
    if (v.startsWith("/workspace/")) v = v.slice("/workspace/".length);
    else if (v === "/workspace") v = "";
    else if (v.startsWith("workspace/")) v = v.slice("workspace/".length);
    return v.replace(/^\/+/, "");
  };

  const candidates: string[] = [];
  const pushIfFile = (p: string): void => {
    try {
      if (existsSync(p) && lstatSync(p).isFile()) candidates.push(realpathSync(p));
    } catch { /* skip */ }
  };

  // Absolute host path the agent may have printed after rewriting (or used literally).
  if (raw.startsWith("/") && !raw.startsWith("/workspace")) {
    pushIfFile(raw);
  }

  const rel = stripWorkspacePrefix(raw);
  const channelRootAbs = ensureChannelWorkspace(channelId);
  const channelWs = channelWorkspace(channelId);
  if (rel) {
    pushIfFile(join(channelWs, rel));
    pushIfFile(join(channelRootAbs, rel));
    pushIfFile(join(channelRootAbs, "files", basename(rel)));
    pushIfFile(join(channelWs, "files", basename(rel)));
    // Host-level /workspace dump used by absolute /workspace paths in shell
    pushIfFile(join("/workspace", rel));
    pushIfFile(join("/workspace/files", basename(rel)));
  } else {
    pushIfFile(join(channelWs, basename(raw)));
  }

  // Prefer files already inside this channel world when both exist.
  const channelPrefix = realpathSync(channelRootAbs) + sep;
  const inChannel = candidates.find((p) => p === realpathSync(channelRootAbs) || p.startsWith(channelPrefix));
  if (inChannel) return inChannel;
  if (candidates[0]) return candidates[0];
  throw new Error("File not found.");
}

/**
 * Copy a channel-workspace (or host /workspace) file into the chat attachment store.
 */
export function attachWorkspaceFileToMessage(
  channelId: number,
  messageId: number,
  threadId: number | null,
  requestedPath: string,
  createdBy = "agent",
  displayName?: string,
): { id: number; name: string; mime: string; size: number; path: string } {
  const msg = q1("SELECT id, channel_id FROM messages WHERE id=?", messageId);
  if (!msg || Number(msg.channel_id) !== channelId) throw new Error("Message does not belong to this channel.");
  const existing = Number(q1("SELECT COUNT(*) AS n FROM attachments WHERE message_id=?", messageId)?.n || 0);
  if (existing >= 20) throw new Error("Messages are limited to 20 attachments.");

  let absolute = resolveAgentFilePath(channelId, requestedPath);
  const channelRootAbs = realpathSync(ensureChannelWorkspace(channelId));
  const insideChannel = absolute === channelRootAbs || absolute.startsWith(channelRootAbs + sep);

  // If the only copy lives on host /workspace, import into channel files/ so the world stays coherent.
  if (!insideChannel) {
    const tokenTmp = randomBytes(20).toString("hex");
    copyFileSync(absolute, join(UPLOAD_DIR, tokenTmp));
    const imported = importAttachment(channelId, threadId, tokenTmp, displayName?.trim() || basename(absolute), createdBy);
    try { unlinkSync(join(UPLOAD_DIR, tokenTmp)); } catch { /* token reused below if needed */ }
    if (imported) {
      absolute = resolveWorldFile(channelId, imported);
    }
  }

  const name = (displayName?.trim() || basename(absolute)).slice(0, 255) || "file";
  const mime = guessMime(name).slice(0, 255);
  const stat = statSync(absolute);
  if (!stat.isFile()) throw new Error("Not a file.");
  if (stat.size > 25 * 1024 * 1024) throw new Error("Attachments are limited to 25 MB.");

  const token = randomBytes(20).toString("hex");
  copyFileSync(absolute, join(UPLOAD_DIR, token));
  const id = run(
    "INSERT INTO attachments (message_id, name, mime, size, path) VALUES (?,?,?,?,?)",
    messageId, name, mime, stat.size, token,
  ).lastInsertRowid;

  const worldRel = worldRelSafe(channelId, absolute);
  const underChannelFiles = worldRel.startsWith("files/");
  if (!underChannelFiles && (absolute.startsWith(channelRootAbs + sep) || absolute === channelRootAbs)) {
    // Ensure Files tab sees workspace-originated artifacts
    run(
      `INSERT INTO artifacts (channel_id, thread_id, path, kind, created_by, size, modified, created) VALUES (?,?,?,'file',?,?,?,?)
       ON CONFLICT(channel_id,path) DO UPDATE SET thread_id=COALESCE(excluded.thread_id,artifacts.thread_id),size=excluded.size,modified=excluded.modified`,
      channelId, threadId, worldRel.startsWith("workspace/") ? worldRel : `workspace/${basename(absolute)}`, createdBy, stat.size, stat.mtimeMs, now(),
    );
  }

  return { id: Number(id), name, mime, size: stat.size, path: worldRel };
}

function worldRelSafe(channelId: number, absolute: string): string {
  try {
    return relative(channelRoot(channelId), absolute).split(sep).join("/");
  } catch {
    return basename(absolute);
  }
}

export function setAgentStatus(agentId: number, status: string, channelId: number): void {
  if (!["ready", "working", "waiting", "paused", "archived"].includes(status)) return;
  run("UPDATE agents SET status=? WHERE id=? AND status<>'deleted'", status, agentId);
  run("INSERT INTO channel_activity (channel_id, kind, summary, status, actor_type, created) VALUES (?,'agent_status',?,?, 'system',?)", channelId, `Agent is ${status}.`, status, now());
}

export async function archiveChannel(channelId: number): Promise<void> {
  const channel = q1("SELECT name, status FROM channels WHERE id=? AND kind='channel'", channelId);
  if (!channel) throw new Error("Channel not found.");
  if (String(channel.name) === "main") throw new Error("#main cannot be archived.");
  await archiveChannelComputer(channelId);
  tx(() => {
    run("UPDATE channels SET status='archived' WHERE id=?", channelId);
    run("UPDATE agents SET status='archived' WHERE id=(SELECT agent_id FROM agent_channels WHERE channel_id=?)", channelId);
    run(
      "UPDATE agent_followups SET status='cancelled', updated=?, last_error='channel archived' WHERE channel_id=? AND status IN ('pending','running')",
      now(),
      channelId,
    );
    run("UPDATE agent_workflows SET status='paused',updated=?,last_error='channel archived' WHERE channel_id=? AND status='active'", now(), channelId);
    run("UPDATE channel_computer_obligations SET status='cancelled',updated=? WHERE channel_id=? AND kind='followup' AND status='active'", now(), channelId);
    run("UPDATE channel_computer_obligations SET status='cancelled',updated=? WHERE channel_id=? AND kind='workflow' AND status='active'", now(), channelId);
    run("INSERT INTO channel_activity (channel_id, kind, summary, actor_type, created) VALUES (?,'lifecycle','Channel archived; agent world preserved.','system',?)", channelId, now());
  });
}

export async function restoreChannel(channelId: number): Promise<void> {
  const channel = q1("SELECT name FROM channels WHERE id=? AND status='archived'", channelId);
  if (!channel) throw new Error("Archived channel not found.");
  tx(() => {
    run("UPDATE channels SET status='active' WHERE id=?", channelId);
    // Only clear the archived marker; a previously waiting/failed agent keeps its real status.
    run("UPDATE agents SET status='ready' WHERE id=(SELECT agent_id FROM agent_channels WHERE channel_id=?) AND status='archived'", channelId);
    run("INSERT INTO channel_activity (channel_id, kind, summary, actor_type, created) VALUES (?,'lifecycle','Channel restored with the same agent world.','system',?)", channelId, now());
  });
  ensureChannelWorkspace(channelId);
  await restoreChannelComputer(channelId);
}

export async function deleteChannelWorld(channelId: number, confirmation: string): Promise<void> {
  const channel = q1("SELECT * FROM channels WHERE id=? AND kind='channel'", channelId);
  if (!channel) throw new Error("Channel not found.");
  if (String(channel.name) === "main") throw new Error("#main cannot be deleted.");
  if (String(channel.status) !== "archived") throw new Error("Archive the channel before permanent deletion.");
  if (confirmation !== String(channel.name)) throw new Error("Type the channel name to confirm permanent deletion.");
  const agent = q1("SELECT a.id, a.bot_id FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=?", channelId);
  const attachmentPaths = q(`SELECT at.path FROM attachments at JOIN messages m ON m.id=at.message_id WHERE m.channel_id=?`, channelId).map((row) => String(row.path));
  const root = channelRoot(channelId);
  const tombstone = `${root}.deleting-${now()}`;
  if (existsSync(root)) renameSync(root, tombstone);
  try { await deleteChannelComputer(channelId); }
  catch (error) {
    if (existsSync(tombstone) && !existsSync(root)) renameSync(tombstone, root);
    throw error;
  }
  try { tx(() => {
    run("DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?)", channelId);
    run("DELETE FROM tool_actions WHERE thread_id IN (SELECT id FROM threads WHERE channel_id=?)", channelId);
    run("DELETE FROM escalations WHERE channel_id=?", channelId);
    run("DELETE FROM memory_items WHERE channel_id=?", channelId);
    run("DELETE FROM artifacts WHERE channel_id=?", channelId);
    run("DELETE FROM channel_activity WHERE channel_id=?", channelId);
    run("DELETE FROM threads WHERE channel_id=?", channelId);
    run("DELETE FROM messages WHERE channel_id=?", channelId);
    if (agent) {
      run("DELETE FROM tool_actions WHERE agent_id=?", agent.id);
      run("DELETE FROM agent_channels WHERE agent_id=?", agent.id);
      run("DELETE FROM agent_profiles WHERE agent_id=?", agent.id);
      run("DELETE FROM agent_capabilities WHERE agent_id=?", agent.id);
      run("DELETE FROM agents WHERE id=?", agent.id);
      if (agent.bot_id) {
        run("DELETE FROM bot_channels WHERE bot_id=?", agent.bot_id);
        run("DELETE FROM bot_computers WHERE bot_id=?", agent.bot_id);
        run("DELETE FROM model_prefs WHERE bot_id=?", agent.bot_id);
        run("DELETE FROM bots WHERE id=?", agent.bot_id);
      }
    }
    run("DELETE FROM channel_workspaces WHERE channel_id=?", channelId);
    run("DELETE FROM members WHERE channel_id=?", channelId);
    run("DELETE FROM channels WHERE id=?", channelId);
  }); } catch (error) {
    if (existsSync(tombstone) && !existsSync(root)) renameSync(tombstone, root);
    throw error;
  }
  rmSync(tombstone, { recursive: true, force: true });
  for (const path of new Set(attachmentPaths)) {
    if (q1("SELECT 1 FROM attachments WHERE path=? LIMIT 1", path)) continue;
    try { unlinkSync(join(UPLOAD_DIR, path)); } catch { /* already gone */ }
  }
}

export function readProfileFile(channelId: number): unknown {
  return JSON.parse(readFileSync(join(ensureChannelWorkspace(channelId), "profile", "agent.json"), "utf8"));
}
