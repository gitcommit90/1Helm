import { q, q1, run, type Row } from "./db.ts";
import { createMessage, serializeMessage, resolveModel, botEndpoint } from "./store.ts";
import { getComputer, execOnComputer } from "./computer.ts";
import { broadcastToChannel } from "./events.ts";
import { isChatGPTProvider, streamChatGPTCompletion } from "./chatgpt.ts";

type ChatMsg = { role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const MAX_TOOL_ROUNDS = 6;

/** Build the system prompt, including assigned computers and the permission grant. */
function systemPrompt(bot: Row): string {
  const computers = q("SELECT c.* FROM computers c JOIN bot_computers bc ON bc.computer_id=c.id WHERE bc.bot_id=?", bot.id);
  let p = `You are ${bot.name}, an AI assistant inside the 1Helm workspace. You are replying within a thread. Keep answers focused and useful. Use Markdown.`;
  if (bot.prompt) p += `\n\n${bot.prompt}`;
  if (computers.length) {
    p += `\n\nYou have been assigned the following computers:\n` +
      computers.map((c) => `- "${c.name}" (computer_id ${c.id})`).join("\n") +
      `\n\nThe user has granted you full permission to act on their behalf on these computers. ` +
      `When the user references a computer or asks you to run, inspect, install, or change anything, use the run_command tool to execute shell commands on the appropriate computer. ` +
      `Prefer verifying state before making changes, and report what you did.`;
  } else {
    p += `\n\nYou have no computers assigned, so you cannot run commands. Answer from your own knowledge.`;
  }
  return p;
}

function toolsFor(bot: Row): unknown[] | undefined {
  const computers = q("SELECT computer_id FROM bot_computers WHERE bot_id=?", bot.id);
  if (!computers.length) return undefined;
  return [{
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command on one of the assigned computers and return its output.",
      parameters: {
        type: "object",
        properties: {
          computer_id: { type: "integer", description: "Which assigned computer to run on." },
          command: { type: "string", description: "The shell command to execute." },
        },
        required: ["command"],
      },
    },
  }];
}

/** Gather context messages for the bot. Thread trigger → full thread; channel trigger → fresh (no history). */
function buildContext(bot: Row, channelId: number, triggerId: number, threadRootId: number | null, fresh: boolean): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: "system", content: systemPrompt(bot) }];
  const rows = fresh
    ? q("SELECT * FROM messages WHERE id=?", triggerId)
    : q("SELECT * FROM messages WHERE (id=? OR parent_id=?) AND id<=? ORDER BY id", threadRootId, threadRootId, triggerId);
  for (const m of rows) {
    if (Number(m.bot_id) === Number(bot.id)) { msgs.push({ role: "assistant", content: String(m.body) }); continue; }
    const name = m.bot_id
      ? (q1("SELECT name FROM bots WHERE id=?", m.bot_id)?.name as string)
      : (q1("SELECT display FROM users WHERE id=?", m.user_id)?.display as string) || "user";
    msgs.push({ role: "user", content: `${name}: ${stripMention(String(m.body), String(bot.name))}` });
  }
  return msgs;
}

const stripMention = (body: string, botName: string): string =>
  body.replace(new RegExp(`@${botName}\\b`, "gi"), "").trim() || body;

/**
 * Run a bot in response to a mention.
 * @param fresh true when mentioned at channel top-level (no context, reply opens a thread).
 */
export async function runBot(bot: Row, channelId: number, triggerId: number, threadRootId: number, fresh: boolean): Promise<void> {
  const model = resolveModel(Number(bot.id), channelId, threadRootId);
  const endpoint = botEndpoint(Number(bot.id));
  const provider = bot.provider_id ? q1("SELECT kind, base_url FROM providers WHERE id=?", bot.provider_id) : undefined;
  const isChatGPT = isChatGPTProvider(provider);
  const msgId = createMessage({ channelId, parentId: threadRootId, botId: Number(bot.id), body: "" });
  const emit = (): void => broadcastToChannel(channelId, { type: "message_update", message: serializeMessage(msgId) });
  let body = "";
  const setBody = (t: string): void => { body = t; run("UPDATE messages SET body=? WHERE id=?", body, msgId); emit(); };

  if (!endpoint && !isChatGPT) { setBody(`_No provider connected for **${bot.name}**. Add a provider in Settings and select it on the bot._`); return; }
  if (!model) { setBody(`_No model configured. Set a default model for **${bot.name}** in Settings, or a model for this channel/thread._`); return; }
  broadcastToChannel(channelId, { type: "message", message: serializeMessage(msgId) });

  const messages = buildContext(bot, channelId, triggerId, threadRootId, fresh);
  const tools = toolsFor(bot);
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const { content, toolCalls } = isChatGPT
        ? await streamChatGPTCompletion(model, messages, tools, (delta) => setBody(body + delta))
        : await streamCompletion(endpoint!, model, messages, tools, (delta) => setBody(body + delta));
      if (toolCalls.length && round < MAX_TOOL_ROUNDS) {
        messages.push({ role: "assistant", content: content || "", tool_calls: toolCalls });
        for (const tc of toolCalls) {
          const args = safeParse(tc.function.arguments);
          const cmd = String(args.command || "");
          const compId = Number(args.computer_id) || defaultComputer(Number(bot.id));
          setBody(body + `\n\n\`$ ${cmd}\`\n`);
          const result = await runTool(compId, cmd);
          messages.push({ role: "tool", tool_call_id: tc.id, name: "run_command", content: result });
        }
        setBody(body + "\n");
        continue;
      }
      if (content && !body.trim()) setBody(content);
      break;
    }
  } catch (e) {
    setBody(body + `\n\n_Error contacting model: ${(e as Error).message}_`);
  }
}

const defaultComputer = (botId: number): number => Number(q1("SELECT computer_id FROM bot_computers WHERE bot_id=?", botId)?.computer_id) || 0;

async function runTool(computerId: number, command: string): Promise<string> {
  const computer = getComputer(computerId);
  if (!computer) return `Error: computer ${computerId} is not available.`;
  try {
    const r = await execOnComputer(computer, command);
    return `exit_code=${r.exit_code}\n${r.output || "(no output)"}`.slice(0, 8000);
  } catch (e) {
    return `Error running command: ${(e as Error).message}`;
  }
}

const safeParse = (s: string): Record<string, unknown> => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

/** Stream an OpenAI-compatible chat completion, invoking onDelta for content tokens. */
async function streamCompletion(
  endpoint: { base_url: string; api_key: string }, model: string, messages: ChatMsg[], tools: unknown[] | undefined, onDelta: (d: string) => void,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const base = endpoint.base_url.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(endpoint.api_key ? { authorization: `Bearer ${endpoint.api_key}` } : {}) },
    body: JSON.stringify({ model, messages, stream: true, ...(tools ? { tools, tool_choice: "auto" } : {}) }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);

  let content = "";
  const toolMap = new Map<number, ToolCall>();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
      try { chunk = JSON.parse(payload); } catch { continue; }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) { content += delta.content; onDelta(delta.content); }
      for (const tc of delta.tool_calls || []) {
        const cur = toolMap.get(tc.index) || { id: "", type: "function", function: { name: "", arguments: "" } };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name = tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        toolMap.set(tc.index, cur);
      }
    }
  }
  return { content, toolCalls: [...toolMap.values()].filter((t) => t.function.name) };
}
