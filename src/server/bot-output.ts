/** Pure user-facing fallbacks used when a model finishes after a tool call. */
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
