import { q, q1, run, now, type Row } from "./db.ts";
import { addBotToChannel, createMessage, serializeMessage } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { fetchModels } from "./computer.ts";
import { CHATGPT_KIND, listChatGPTModels } from "./chatgpt.ts";
import { ensureChannelWorkspace, ensureSkipperAgent } from "./agents.ts";
import { internalRoutingProviderId, routingModels } from "./routing.ts";

export type Workspace = {
  name: string;
  terminals_enabled: boolean;
  setup_complete: boolean;
  photo_url: string | null;
  theme: string;
};

const SKIPPER_PROMPT =
  "You are Skipper, the one workspace-wide chief of staff and root operator for this 1Helm environment. " +
  "The human owner is the Captain and final authority. Every ordinary channel has one resident agent, workspace, files, threads, and memory. " +
  "Work across channels and at host scope when explicitly asked, provision and repair channel worlds, and broker missing capabilities or credentials. " +
  "When invoked from a thread, use its complete context and keep every action and outcome visible in that same thread. " +
  "You oversee and unblock; do not absorb a resident agent's reply style or preferences. After you help, use call_agent to hand work back so the resident finishes—never leave the Captain to re-tag them. " +
  "Be concrete, action-oriented, and concise. Prefer doing the next useful step over abstract advice.";

const FREE_MODEL_PREFS = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "qwen/qwen3-32b:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
];

export function workspaceRow(): Row {
  const row = q1("SELECT * FROM workspace WHERE id=1");
  if (row) return row;
  run("INSERT INTO workspace (id, name, terminals_enabled, setup_complete, created) VALUES (1,'My Workspace',1,0,?)", now());
  return q1("SELECT * FROM workspace WHERE id=1")!;
}

export function workspaceView(row: Row = workspaceRow()): Workspace {
  return {
    name: String(row.name || "My Workspace"),
    terminals_enabled: Boolean(row.terminals_enabled),
    setup_complete: Boolean(row.setup_complete),
    photo_url: row.photo_mime ? "/api/workspace/photo" : null,
    theme: String(row.theme || "graphite"),
  };
}

export function setupStatus(): {
  needs_setup: boolean;
  has_users: boolean;
  setup_complete: boolean;
  workspace: Workspace;
  provider_count: number;
} {
  const hasUsers = Number(q1("SELECT COUNT(*) n FROM users")?.n || 0) > 0;
  const ws = workspaceView();
  return {
    needs_setup: !hasUsers || !ws.setup_complete,
    has_users: hasUsers,
    setup_complete: ws.setup_complete,
    workspace: workspaceView(),
    provider_count: Number(q1("SELECT COUNT(*) n FROM providers")?.n || 0),
  };
}

/** Prefer a free OpenRouter model when available; otherwise the first model on the provider. */
export async function pickDefaultModel(providerId: number): Promise<string> {
  const prov = q1("SELECT * FROM providers WHERE id=?", providerId);
  if (!prov) return "";
  let models: string[] = [];
  try {
    if (String(prov.kind) === CHATGPT_KIND) models = await listChatGPTModels();
    else models = await fetchModels(String(prov.base_url), String(prov.api_key));
  } catch {
    return "";
  }
  if (!models.length) return "";
  if (String(prov.kind) === "openrouter") {
    for (const preferred of FREE_MODEL_PREFS) {
      if (models.includes(preferred)) return preferred;
    }
    const free = models.find((m) => /:free$/i.test(m));
    if (free) return free;
  }
  return models[0];
}

export function ensureMainChannel(createdBy?: number | null): number {
  const existing = q1("SELECT id FROM channels WHERE kind='channel' AND name='main' LIMIT 1");
  if (existing) {
    const id = Number(existing.id);
    if (createdBy) run("INSERT OR IGNORE INTO members (channel_id, user_id) VALUES (?,?)", id, createdBy);
    return id;
  }
  const id = run(
    "INSERT INTO channels (name, slug, kind, topic, purpose, status, created_by, created) VALUES ('main','main','channel','Your home base with @skipper','Workspace-wide coordination with Skipper','active',?,?)",
    createdBy ?? null,
    now(),
  ).lastInsertRowid;
  for (const u of q("SELECT id FROM users")) run("INSERT OR IGNORE INTO members (channel_id, user_id) VALUES (?,?)", id, u.id);
  return id;
}

export async function ensureSkipper(providerId: number, model: string, terminalsEnabled: boolean): Promise<number> {
  const existing = q1("SELECT * FROM bots WHERE lower(name)='skipper' LIMIT 1");
  let botId: number;
  if (existing) {
    botId = Number(existing.id);
    run("UPDATE bots SET provider_id=?, model=?, prompt=? WHERE id=?", providerId, model || existing.model, SKIPPER_PROMPT, botId);
  } else {
    botId = run(
      "INSERT INTO bots (name, provider_id, model, prompt, avatar, base_url, api_key, created) VALUES (?,?,?,?,?,'','',?)",
      "skipper",
      providerId,
      model,
      SKIPPER_PROMPT,
      "",
      now(),
    ).lastInsertRowid;
  }

  // Human terminal visibility does not limit Skipper's host-level authority.
  run("DELETE FROM bot_computers WHERE bot_id=?", botId);
  for (const c of q("SELECT id FROM computers")) {
    run("INSERT OR IGNORE INTO bot_computers (bot_id, computer_id) VALUES (?,?)", botId, c.id);
  }
  return botId;
}

function welcomeBody(workspaceName: string, terminalsEnabled: boolean): string {
  const terminalLine = terminalsEnabled
    ? "Each channel's Terminal opens directly in that agent's workspace."
    : "Channel terminals are hidden for now; the resident agents still keep their durable workspaces.";
  return [
    `Hey — I'm **@skipper**, your workspace-wide chief of staff for **${workspaceName}**.`,
    "",
    "Create a channel for anything. It comes with one resident agent, a durable computer workspace, files, threads, and provider-neutral memory — no bot wiring or directory setup required.",
    "",
    "Mention me with `@skipper` in any channel thread when its resident agent needs host-level work, another channel, a missing capability, credentials, or Captain input. I receive the complete thread and answer there.",
    "",
    terminalLine,
    "",
    "One Helm. One Captain. One Skipper. Many channel worlds.",
  ].join("\n");
}

export async function completeSetup(opts: {
  name: string;
  terminalsEnabled: boolean;
  userId: number;
  providerId?: number;
  model?: string;
}): Promise<{ workspace: Workspace; channelId: number; skipperId: number; welcome: Row }> {
  const name = opts.name.trim() || "My Workspace";
  let selectedProviderId = opts.providerId;
  let selectedModel = opts.model?.trim() || "";
  if (!selectedProviderId) {
    const models = await routingModels();
    if (!models.length) throw new Error("Connect a provider with at least one enabled model before finishing setup.");
    const existingDefault = String(workspaceRow().default_model || "");
    selectedModel = models.find((model) => model.id === existingDefault)?.id
      || models.find((model) => model.kind === "route")?.id
      || models[0].id;
    selectedProviderId = await internalRoutingProviderId();
  }
  const provider = q1("SELECT * FROM providers WHERE id=?", selectedProviderId);
  if (!provider) throw new Error("Connect an AI provider before finishing setup.");

  const model = selectedModel
    || (await pickDefaultModel(Number(provider.id)))
    || String(provider.kind === "chatgpt" ? "gpt-5.4" : "");
  if (!model) throw new Error("The connected provider does not expose an enabled model yet.");
  const channelId = ensureMainChannel(opts.userId);
  const skipperId = await ensureSkipper(Number(provider.id), model, opts.terminalsEnabled);
  addBotToChannel(skipperId, channelId);
  ensureSkipperAgent(skipperId, channelId);
  ensureChannelWorkspace(channelId);

  // Canned welcome — do not wait on an LLM for the first impression.
  let welcomeMsg = q1(
    "SELECT id FROM messages WHERE channel_id=? AND bot_id=? AND parent_id IS NULL ORDER BY id LIMIT 1",
    channelId,
    skipperId,
  );
  if (!welcomeMsg) {
    const id = createMessage({
      channelId,
      parentId: null,
      botId: skipperId,
      body: welcomeBody(name, opts.terminalsEnabled),
    });
    welcomeMsg = { id };
    broadcastToChannel(channelId, { type: "message", message: serializeMessage(id) });
  }

  run(
    "UPDATE workspace SET name=?, terminals_enabled=?, setup_complete=1, default_provider_id=?, default_model=? WHERE id=1",
    name,
    opts.terminalsEnabled ? 1 : 0,
    provider.id,
    model,
  );

  return {
    workspace: workspaceView(),
    channelId,
    skipperId,
    welcome: serializeMessage(Number(welcomeMsg.id))!,
  };
}
