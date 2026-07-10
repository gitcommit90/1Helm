import { q, q1, run, now, type Row } from "./db.ts";
import { addBotToChannel, createMessage, serializeMessage } from "./store.ts";
import { broadcastToChannel } from "./events.ts";
import { fetchModels } from "./computer.ts";
import { CHATGPT_KIND, listChatGPTModels } from "./chatgpt.ts";

export type Workspace = {
  name: string;
  terminals_enabled: boolean;
  setup_complete: boolean;
};

const SKIPPER_PROMPT =
  "You are Skipper, the chief of staff for this 1Helm workspace. " +
  "Help the owner create channels, configure providers and bots, and keep the workspace organized. " +
  "Be concrete, action-oriented, and concise. Prefer doing the next useful step over abstract advice. " +
  "One-click apps as dedicated channels are coming next — until then, guide the owner with the tools available now.";

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
    "INSERT INTO channels (name, kind, topic, created_by, created) VALUES ('main','channel','Your home base with @skipper',?,?)",
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

  // Give Skipper the local computer when terminals are enabled so it can act on the box.
  run("DELETE FROM bot_computers WHERE bot_id=?", botId);
  if (terminalsEnabled) {
    for (const c of q("SELECT id FROM computers")) {
      run("INSERT OR IGNORE INTO bot_computers (bot_id, computer_id) VALUES (?,?)", botId, c.id);
    }
  }
  return botId;
}

function welcomeBody(workspaceName: string, terminalsEnabled: boolean): string {
  const terminalLine = terminalsEnabled
    ? "Terminals are enabled in the sidebar if you want a live shell on this machine."
    : "Terminals are turned off for this workspace — you can enable them later in Settings if you need a live shell.";
  return [
    `Hey — I'm **@skipper**, your chief of staff for **${workspaceName}**.`,
    "",
    "I can help you create channels, connect providers, and set up specialized bots for focused work. Mention me in a thread with `@skipper` whenever you want help.",
    "",
    "One-click apps that become their own channels are next on the roadmap. For now, this is your home base.",
    "",
    terminalLine,
    "",
    "Welcome aboard.",
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
  const provider = opts.providerId
    ? q1("SELECT * FROM providers WHERE id=?", opts.providerId)
    : q1("SELECT * FROM providers ORDER BY id LIMIT 1");
  if (!provider) throw new Error("Connect an AI provider before finishing setup.");

  const model = opts.model?.trim()
    || (await pickDefaultModel(Number(provider.id)))
    || String(provider.kind === "chatgpt" ? "gpt-5.4" : "");
  if (!model) throw new Error("Choose a model before finishing setup.");
  const channelId = ensureMainChannel(opts.userId);
  const skipperId = await ensureSkipper(Number(provider.id), model, opts.terminalsEnabled);
  addBotToChannel(skipperId, channelId);

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
    "UPDATE workspace SET name=?, terminals_enabled=?, setup_complete=1 WHERE id=1",
    name,
    opts.terminalsEnabled ? 1 : 0,
  );

  return {
    workspace: workspaceView(),
    channelId,
    skipperId,
    welcome: serializeMessage(Number(welcomeMsg.id))!,
  };
}
