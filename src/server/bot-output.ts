export { MAX_VISION_ENCODED_BYTES_PER_REQUEST, MAX_VISION_IMAGES_PER_REQUEST, prepareImageFile } from "./vision.ts";
export type { ChatContent, ChatContentPart, ImageDetail } from "./vision.ts";
export { calculateModelContext, calculateModelOutput } from "./model-metrics.ts";
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

/** Explicit output budget sent on every direct provider call. Without it the
 * router applies its own tiny default (4096 for Claude), which silently
 * truncates reasoning and tool arguments mid-stream. Reasoning models need
 * room to think; 100k is the floor, never the ceiling. */
export const MAX_OUTPUT_TOKENS = Math.max(100000, Number(process.env.CTRL_MAX_OUTPUT_TOKENS || 100000));
export const OUTPUT_TRUNCATED_ERROR = "The model's response was cut off by the output token limit before it finished. Nothing was executed from the truncated response.";
/** Tools whose required arguments must be present before 1Helm executes them.
 * A truncated or unparseable tool call must never run as an empty command. */
export function toolCallArgumentError(name: string, rawArguments: string, args: Record<string, unknown>): string {
  const raw = String(rawArguments || "").trim();
  if (raw && raw !== "{}") {
    try { JSON.parse(raw); } catch { return `Error: ${name} arguments were not valid JSON (likely truncated). The call was not executed.`; }
  }
  const required: Record<string, string[]> = {
    run_command: ["command"], text_captain: ["message"], remember: ["kind", "content"], schedule_followup: ["delay_seconds", "reason"],
    schedule_workflow: ["name", "prompt", "interval_seconds"], inspect_web_source: ["url"], search_web: ["query"], attach_file: ["path"], view_image: ["path"],
    read_skill: ["slug"], request_skill: ["skill", "reason"], read_channel_session: ["thread_root_id"], set_workflow_status: ["workflow_id", "status"],
    ask_user: ["blocker_kind", "evidence", "questions"], attach_web_image: ["image_url", "source_url", "caption"], propose_skill: ["name", "description", "instructions", "evidence", "rationale"],
    generate_image: ["prompt"], complete_followup: ["evidence"], silent_success: ["reason"],
  };
  const missing = (required[name] || []).filter((key) => args[key] === undefined || args[key] === null || (typeof args[key] === "string" && !String(args[key]).trim()));
  if (missing.length) return `Error: ${name} was called without required argument${missing.length > 1 ? "s" : ""} ${missing.join(", ")} (the call was likely truncated). It was not executed.`;
  return "";
}

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
  if (["grant_gmail_access", "connect_gmail", "create_channel", "list_channels", "inspect_channel", "archive_channel", "restore_channel", "delete_channel", "inspect_fleet", "care_for_channel_computer", "list_obligations", "run_thread_audit", "run_agent_review", "remember", "search_channel_history", "read_channel_session", "call_skipper", "call_agent", "request_skill", "propose_skill", "create_skill", "search_skill_catalog", "inspect_skill", "install_skill", "invite_agent", "search_web", "inspect_web_source", "attach_web_image", "attach_file", "view_image", "generate_image", "text_captain", "schedule_followup", "schedule_workflow", "list_workflows", "set_workflow_status"].includes(tool)) return result;
  if (tool === "gmail_list_accounts") {
    try {
      const parsed = JSON.parse(result) as { accounts?: string[] };
      return `Gmail access is available for: ${(parsed.accounts || []).join(", ") || "no accounts"}.`;
    } catch { return result; }
  }
  // A raw command result is not an answer. Publishing it as one hid every
  // silently truncated Claude turn behind a "completed" reply; return nothing so
  // the runtime fails the turn loudly instead.
  if (tool === "run_command") return "";
  return `The ${tool.replaceAll("_", " ")} action completed.\n\n${result}`;
}

function actionObject(tool: string, input: string, actor: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (tool === "create_channel") return clean.split(" — ")[0] || "a channel";
  if (tool === "attach_file" || tool === "view_image") return clean.split(/[\\/]/).at(-1) || "a file";
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
    run_command: "Ran work in", create_channel: "Created", remember: "Recorded", attach_file: "Attached", view_image: "Viewed",
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
type CacheControl = { type: "ephemeral" };
type CacheTextBlock = { type: "text"; text: string; cache_control?: CacheControl };
type CacheImageBlock = { type: "image_url"; image_url: { url: string; detail?: "low" | "high" }; cache_control?: CacheControl };
export type ProviderCacheMessage = {
  role: string;
  content: string | Array<CacheTextBlock | CacheImageBlock>;
  tool_call_id?: string;
  name?: string;
  tool_calls?: unknown[];
  extra_content?: {
    anthropic?: { tool_result?: { type: "tool_result"; tool_use_id: string; content: string; cache_control?: CacheControl } };
    openai?: { cache_scope?: "stable_instruction" | "dynamic_context" | "inline_context" };
  };
};
export type ProviderCacheRequest = { messages: ProviderCacheMessage[]; prompt_cache_key?: string };


/** Supply a stable route-affinity key. Provider-specific cache shaping belongs
 * in ReRouted after destination selection, so aliases and fallbacks behave the
 * same as directly addressed providers. */
export function providerCacheRequest(model: string, messages: ProviderCacheMessage[], scope: string): ProviderCacheRequest {
  return {
    messages,
    prompt_cache_key: createHash("sha256").update(`1helm\0${scope}\0${model}`).digest("hex"),
  };
}
