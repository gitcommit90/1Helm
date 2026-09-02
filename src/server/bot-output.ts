import { createHash } from "node:crypto";

/** Pure user-facing fallbacks used when a model finishes after a tool call. */
export const SKIPPER_CALL_APPROVAL_KIND = "skipper_call_approval";
export const SKIPPER_CALL_APPROVE_ONCE = "Approve (once)";
export const SKIPPER_CALL_APPROVE_THREAD = "Approve (always for thread)";
export const SKIPPER_CALL_DENY = "Deny";
export const skipperCallApprovalPayload = (reason: string, actionId: number, progressId: number): Record<string, unknown> => ({
  kind: SKIPPER_CALL_APPROVAL_KIND, reason: String(reason || "").slice(0, 4000), action_id: actionId, progress_id: progressId,
  intro: "This resident wants to call Skipper into the thread.", questions: [{ id: "q1", header: "Skipper", question: "Allow this call to Skipper?", multi_select: false, options: [
    { label: SKIPPER_CALL_APPROVE_ONCE, description: "Allows this call only." },
    { label: SKIPPER_CALL_APPROVE_THREAD, description: "Allows this call and future Skipper calls in this thread." },
    { label: SKIPPER_CALL_DENY, description: "Does not call Skipper." },
  ] }],
});

export function completedToolAnswer(tool: string, result: string): string {
  if (tool === "gmail_search") {
    try {
      const parsed = JSON.parse(result) as { account?: string; query?: string; results?: { from?: string; subject?: string; date?: string; snippet?: string }[] };
      const matches = parsed.results || [];
      const lines = matches.map((message, index) => [
        `${index + 1}. **${message.subject || "(no subject)"}**`,
        message.from ? `From: ${message.from}` : "",
        message.date ? `Date: ${message.date}` : "",
        message.snippet || "",
      ].filter(Boolean).join(" — "));
      return [`Gmail search completed for **${parsed.account || "the granted account"}**.`, `Query: \`${parsed.query || ""}\``, `Matches: **${matches.length}**.`, ...lines].join("\n\n");
    } catch { return "Gmail search completed, but the model did not produce a final explanation. The result remains available in this session."; }
  }
  if (tool === "gmail_get") {
    try {
      const parsed = JSON.parse(result) as { account?: string; from?: string; to?: string; subject?: string; date?: string; body?: string };
      return [`Read the Gmail message in **${parsed.account || "the granted account"}**.`, `**From:** ${parsed.from || ""}`, `**To:** ${parsed.to || ""}`, `**Subject:** ${parsed.subject || ""}`, parsed.date ? `**Date:** ${parsed.date}` : "", "", parsed.body || "(empty body)"].filter(Boolean).join("\n");
    } catch { return "The Gmail message was read, but the model did not produce a final explanation."; }
  }
  if (tool === "gmail_create_draft") {
    try {
      const parsed = JSON.parse(result) as { account?: string; draft_id?: string };
      return `Created a Gmail draft in **${parsed.account || "the granted account"}**${parsed.draft_id ? ` (draft ${parsed.draft_id})` : ""}. It was not sent.`;
    } catch { return "Created the Gmail draft. It was not sent."; }
  }
  if (tool === "connect_gmail") {
    try {
      const parsed = JSON.parse(result) as { accounts?: string[]; setup?: { status?: string; authorization_url?: string; error?: string } };
      if (parsed.setup?.authorization_url) return `Gmail authorization is ready. [Authorize Gmail now](${parsed.setup.authorization_url})\n\nThe callback returns directly to this 1Helm installation. OAuth tokens remain host-owned and sending stays disabled.`;
      if (parsed.accounts?.length) return `Connected Gmail accounts: ${parsed.accounts.join(", ")}. Read, search, and draft access is available through 1Helm's host broker; sending is disabled.`;
      return parsed.setup?.error || "Gmail has no connected accounts yet. Open Settings → Connections to add the one-time Google OAuth client and authorize an account.";
    } catch { return result; }
  }
  if (tool === "inspect_web_source") return "The source was inspected successfully, but the model did not produce a final answer. The retrieved result remains available in this session.";
  if (tool === "search_web") return "The web search completed successfully, but the model did not produce a final answer. The retrieved results remain available in this session.";
  if (["grant_gmail_access", "connect_gmail", "create_channel", "list_channels", "inspect_channel", "archive_channel", "restore_channel", "delete_channel", "inspect_fleet", "care_for_channel_computer", "list_obligations", "run_thread_audit", "run_agent_review", "remember", "search_channel_history", "read_channel_session", "call_skipper", "call_agent", "request_skill", "propose_skill", "create_skill", "search_skill_catalog", "inspect_skill", "install_skill", "invite_agent", "search_web", "inspect_web_source", "attach_web_image", "attach_file", "generate_image", "text_captain", "schedule_followup", "schedule_workflow", "list_workflows", "set_workflow_status"].includes(tool)) return result;
  if (tool === "gmail_list_accounts") {
    try {
      const parsed = JSON.parse(result) as { accounts?: string[] };
      return `Gmail access is available for: ${(parsed.accounts || []).join(", ") || "no accounts"}.`;
    } catch { return result; }
  }
  if (tool === "run_command") return `The command completed.\n\n\`\`\`text\n${result}\n\`\`\``;
  return `The ${tool.replaceAll("_", " ")} action completed.\n\n${result}`;
}

function actionObject(tool: string, input: string, actor: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (tool === "create_channel") return clean.split(" — ")[0] || "a channel";
  if (tool === "attach_file") return clean.split(/[\\/]/).at(-1) || "a file";
  if (tool === "call_skipper") return "the host boundary";
  if (tool === "call_agent") return clean.split(":")[0] || "the resident";
  if (tool === "gmail_search") return "granted Gmail";
  if (tool === "gmail_get") return "a granted Gmail message";
  if (tool === "gmail_create_draft") return "a Gmail draft";
  if (tool === "text_captain") return "the configured Captain phone";
  if (tool === "run_command") return actor === "skipper" ? "the host workspace" : "the resident workspace";
  if (tool === "schedule_followup") return "a durable wake";
  if (tool === "schedule_workflow") return "a recurring workflow";
  if (tool === "install_skill") return clean || "a catalog skill";
  if (tool === "search_web") return clean || "the public web";
  if (tool === "inspect_web_source") return clean || "a public HTTPS source";
  if (tool === "attach_web_image") return clean || "a sourced web image";
  return clean.length && clean.length <= 96 ? clean : tool.replaceAll("_", " ");
}

function actionVerb(tool: string): string {
  const verbs: Record<string, string> = {
    run_command: "Ran work in", create_channel: "Created", remember: "Recorded", attach_file: "Attached",
    call_skipper: "Called Skipper across", call_agent: "Handed work back to", invite_agent: "Invited",
    request_skill: "Requested", propose_skill: "Crystallized", create_skill: "Created",
    search_skill_catalog: "Searched", inspect_skill: "Inspected", search_web: "Searched",
    search_channel_history: "Searched", read_channel_session: "Read", inspect_web_source: "Inspected",
    attach_web_image: "Attached", install_skill: "Installed", grant_gmail_access: "Granted",
    gmail_list_accounts: "Listed", gmail_search: "Searched", gmail_get: "Read", gmail_create_draft: "Created",
    text_captain: "Texted",
    schedule_followup: "Scheduled", schedule_workflow: "Scheduled", list_workflows: "Listed",
    set_workflow_status: "Updated", generate_image: "Generated", ask_user: "Opened",
  };
  return verbs[tool] || "Used";
}

export function actionSummary(tool: string, input: string, status: string, actor: string): string {
  const outcome = status === "failed" ? "failed" : status === "running" ? "working" : "complete";
  return `${actionVerb(tool)} ${actionObject(tool, input, actor)} → ${outcome}.`;
}

export function toolActionStatus(result: string): "failed" | "running" | "complete" {
  if (/^Error:/i.test(result) || /^status=failed(?:\n|$)/i.test(result)) return "failed";
  if (/^status=running(?:\n|$)/i.test(result)) return "running";
  return "complete";
}
export type ModelUsage = { input_tokens: number; output_tokens: number; cached_input_tokens: number };
export function normalizeModelUsage(value: unknown): ModelUsage {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : {};
  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
  return {
    input_tokens: Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0),
    output_tokens: Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0),
    cached_input_tokens: Math.max(0, Number(usage.cached_tokens ?? inputDetails.cached_tokens ?? promptDetails.cached_tokens ?? 0) || 0),
  };
}

type CacheControl = { type: "ephemeral" };
type CacheTextBlock = { type: "text"; text: string; cache_control?: CacheControl };
export type ProviderCacheMessage = {
  role: string;
  content: string | CacheTextBlock[];
  tool_call_id?: string;
  name?: string;
  tool_calls?: unknown[];
  extra_content?: { anthropic?: { tool_result?: { type: "tool_result"; tool_use_id: string; content: string; cache_control?: CacheControl } } };
};
export type ProviderCacheRequest = { messages: ProviderCacheMessage[]; prompt_cache_key?: string };

const ephemeralCache = (): CacheControl => ({ type: "ephemeral" });

/** Add only provider-native cache activation metadata. Claude keeps one stable
 * conversation breakpoint plus a rolling three-result frontier, so every tool
 * round retains the preceding full-prefix cache while extending it. */
export function providerCacheRequest(model: string, messages: ProviderCacheMessage[], scope: string): ProviderCacheRequest {
  if (/^xai\//i.test(model)) {
    return {
      messages,
      prompt_cache_key: createHash("sha256").update(`1helm\0${scope}\0${model}`).digest("hex"),
    };
  }
  if (!/^claude\//i.test(model)) return { messages };

  const shaped = messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.map((block) => ({ ...block })) : message.content,
    ...(message.extra_content ? { extra_content: structuredClone(message.extra_content) } : {}),
  }));
  const baseIndex = shaped.findLastIndex((message) => message.role === "user" && Boolean(message.content));
  if (baseIndex >= 0) {
    const message = shaped[baseIndex];
    if (typeof message.content === "string") message.content = [{ type: "text", text: message.content, cache_control: ephemeralCache() }];
    else {
      const textIndex = message.content.findLastIndex((block) => block.type === "text" && Boolean(block.text));
      if (textIndex >= 0) message.content[textIndex] = { ...message.content[textIndex], cache_control: ephemeralCache() };
    }
  }
  const frontier = shaped.map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "tool" && Boolean(message.tool_call_id))
    .slice(-3);
  for (const { message } of frontier) {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    message.extra_content = {
      ...message.extra_content,
      anthropic: {
        ...message.extra_content?.anthropic,
        tool_result: { type: "tool_result", tool_use_id: String(message.tool_call_id), content, cache_control: ephemeralCache() },
      },
    };
  }
  return { messages: shaped };
}
