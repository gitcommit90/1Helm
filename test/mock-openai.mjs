import { createServer } from "node:http";

// Minimal OpenAI-compatible mock: /models + streaming /chat/completions with tool calling.
const PORT = Number(process.argv[2] || 9099);
let scheduleFollowupContinuationRequests = 0;

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/request-stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ schedule_followup_continuations: scheduleFollowupContinuationRequests }));
  }
  if (url.pathname === "/update-manifest") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ version: process.env.MOCK_UPDATE_VERSION || "9.9.9" }));
  }
  if (url.pathname.startsWith("/no-auth/") && req.headers.authorization) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "Authorization must be absent" } }));
  }
  if (url.pathname === "/no-models/models") {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "Model discovery is unavailable" } }));
  }
  if (url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-large" }, { id: "mock-small" }] }));
  }
  if (url.pathname.endsWith("/chat/completions")) {
    let raw = ""; for await (const c of req) raw += c;
    const reqBody = JSON.parse(raw || "{}");
    if (reqBody.messages?.some((message) => message.role === "tool" && message.name === "schedule_followup")) {
      scheduleFollowupContinuationRequests++;
    }
    if (url.pathname.includes("/always-fail/")) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Mock upstream unavailable", type: "api_error" } }));
    }
    const routeMarker = ["fallback-backup", "round-a", "round-b"].find((marker) => url.pathname.includes(`/${marker}/`));
    const serialized = JSON.stringify(reqBody.messages);
    const latestUserIndex = reqBody.messages.findLastIndex((message) => message.role === "user");
    const latestUser = reqBody.messages[latestUserIndex]?.content || "";
    const currentTurnMessages = reqBody.messages.slice(latestUserIndex + 1);
    if (/slow-turn/i.test(latestUser)) await new Promise((resolve) => setTimeout(resolve, 1200));
    if (/live-ui-stream/i.test(latestUser)) await new Promise((resolve) => setTimeout(resolve, 250));
    const hasToolResult = currentTurnMessages.some((m) => m.role === "tool");
    const webSearchResult = [...currentTurnMessages].reverse().find((message) => message.role === "tool" && message.name === "search_web");
    const webInspectResult = [...currentTurnMessages].reverse().find((message) => message.role === "tool" && message.name === "inspect_web_source");
    const webImageResult = [...currentTurnMessages].reverse().find((message) => message.role === "tool" && message.name === "attach_web_image");
    const wantsCurrentEventResearch = reqBody.tools?.some((tool) => tool.function?.name === "search_web")
      && /(?:sinkhole|water[ -]?main|sunset (?:boulevard|blvd)|recent event|two days ago|2 days ago)/i.test(latestUser);
    const wantsRealEventImage = reqBody.tools?.some((tool) => tool.function?.name === "attach_web_image")
      && /(?:show|find|send|give).{0,50}(?:image|photo|picture)/i.test(latestUser)
      && /(?:sinkhole|water[ -]?main|sunset|incident|event)/i.test(latestUser);
    const repeatsTools = /repeat-tool-limit/i.test(serialized);
    const wantsRequestSkill = reqBody.tools?.some((tool) => tool.function?.name === "request_skill") && /request the self-hosting-guide skill/i.test(latestUser) && !hasToolResult;
    const wantsProposeSkill = reqBody.tools?.some((tool) => tool.function?.name === "propose_skill") && /propose a reusable meeting brief skill/i.test(latestUser) && !hasToolResult;
    const wantsInviteAgent = reqBody.tools?.some((tool) => tool.function?.name === "invite_agent") && /invite @?finance-agent/i.test(latestUser) && !hasToolResult;
    const inviteResults = reqBody.messages.filter((message) => message.role === "tool" && message.name === "invite_agent");
    const wantsDuplicateInvite = reqBody.tools?.some((tool) => tool.function?.name === "invite_agent")
      && /invite @?finance-agent twice/i.test(latestUser)
      && inviteResults.length === 1
      && !String(inviteResults[0].content || "").startsWith("Error:");
    // Match the Captain/user turn only — system prompts now mention call_agent/hand-back and must not steal other tool paths.
    const wantsCallAgent = reqBody.tools?.some((tool) => tool.function?.name === "call_agent")
      && /hand (?:the )?work back|call_agent|re-invoke|handoff to resident/i.test(latestUser)
      && !hasToolResult
      && /You are @skipper/i.test(serialized);
    const forcesForbiddenMainCall = /attempt forbidden direct call_agent in #main/i.test(latestUser)
      && !reqBody.messages.some((message) => message.role === "tool" && message.name === "call_agent");
    // Durable follow-up: resident must schedule when async work continues after the turn.
    const wantsScheduleFollowup = reqBody.tools?.some((tool) => tool.function?.name === "schedule_followup")
      && /schedule[_ ]followup|check later|still downloading|async download|wake me/i.test(latestUser)
      && !hasToolResult
      && /You are @\S+-agent/.test(serialized);
    const wantsAskUser = reqBody.tools?.some((tool) => tool.function?.name === "ask_user")
      && /structured interview|ask me structured|multiple choice/i.test(latestUser)
      && !hasToolResult;
    const asksAvailability = /\bdo we have\b/i.test(latestUser) && !hasToolResult;
    const wantsGmailConnect = reqBody.tools?.some((tool) => tool.function?.name === "connect_gmail")
      && /\b(?:connect|set up|authorize)\b[\s\S]{0,80}\bgmail\b|\bgmail\b[\s\S]{0,80}\b(?:connect|set up|authorize)\b/i.test(latestUser)
      && !hasToolResult;
    const wantsAutonomousInstall = reqBody.tools?.some((tool) => tool.function?.name === "run_command")
      && /(?:download|install|set up) (?:openai )?codex/i.test(latestUser)
      && !hasToolResult;
    const residentNetworkFailure = [...reqBody.messages].reverse().find((message) => message.role === "tool" && message.name === "run_command" && /Permission denied.*socket|socket.*Permission denied/is.test(String(message.content || "")));
    const wantsResidentNetworkSetup = reqBody.tools?.some((tool) => tool.function?.name === "run_command")
      && /set up jellyfin|install jellyfin/i.test(latestUser)
      && !hasToolResult
      && /You are @\S+-agent/.test(serialized);
    const wantsResidentNetworkEscalation = reqBody.tools?.some((tool) => tool.function?.name === "call_skipper")
      && Boolean(residentNetworkFailure)
      && !reqBody.messages.some((message) => message.role === "tool" && message.name === "call_skipper")
      && /You are @\S+-agent/.test(serialized);
    const wantsLearnSkill = reqBody.tools?.some((tool) => tool.function?.name === "create_skill")
      && /Learn one new reusable workspace skill/i.test(latestUser)
      && !hasToolResult;
    const inspectedLearnSource = reqBody.messages.find((message) => message.role === "tool" && message.name === "inspect_web_source");
    const wantsInspectLearnSource = reqBody.tools?.some((tool) => tool.function?.name === "inspect_web_source")
      && /Learn one new reusable workspace skill/i.test(latestUser)
      && /https:\/\//i.test(latestUser)
      && !inspectedLearnSource;
    const wantsCallSkipper = reqBody.tools && /call skipper to run whoami/i.test(latestUser) && !hasToolResult && /You are @\S+-agent/.test(serialized);
    const wantsCreateChannel = reqBody.tools?.some((tool) => tool.function?.name === "create_channel") && /create (?:a )?(?:new )?channel/i.test(serialized) && !hasToolResult;
    const wantsListChannels = reqBody.tools?.some((tool) => tool.function?.name === "list_channels") && /what channels exist|list (?:the )?channels/i.test(latestUser) && !hasToolResult;
    const wantsReconcileFleet = reqBody.tools?.some((tool) => tool.function?.name === "care_for_channel_computer") && /reconcile (?:my )?(?:channel computers|fleet)/i.test(latestUser) && !hasToolResult;
    const wantsDeleteChannel = reqBody.tools?.some((tool) => tool.function?.name === "delete_channel") && /(?:sunset|archive)[\s\S]*delete #?ideas|delete #?ideas/i.test(latestUser) && !/"name":"delete_channel"/.test(serialized) && /"name":"archive_channel"/.test(serialized);
    const wantsArchiveChannel = reqBody.tools?.some((tool) => tool.function?.name === "archive_channel") && /(?:sunset|archive)[\s\S]*#?ideas|delete #?ideas/i.test(latestUser) && !hasToolResult;
    const wantsTool = reqBody.tools && /run|exec|whoami|command|create .*file|launch-plan/i.test(serialized) && (!hasToolResult || repeatsTools) && !wantsCallSkipper && !wantsCallAgent && !wantsCreateChannel && !wantsListChannels && !wantsReconcileFleet && !wantsArchiveChannel && !wantsDeleteChannel && !wantsScheduleFollowup;
    const auditMode = /silent thread-status audit/i.test(serialized);

    // Non-stream path used by Skipper thread-audit.
    if (reqBody.stream === false) {
      let content = `Answer complete.${routeMarker ? ` via ${routeMarker}` : ""}`;
      if (auditMode) {
        const dossiers = (() => {
          try {
            const user = [...reqBody.messages].reverse().find((message) => message.role === "user")?.content || "";
            const jsonStart = user.indexOf("[");
            return jsonStart >= 0 ? JSON.parse(user.slice(jsonStart)) : [];
          } catch { return []; }
        })();
        content = JSON.stringify((Array.isArray(dossiers) ? dossiers : []).map((dossier) => {
          const blob = `${dossier.title || ""}\n${dossier.summary || ""}\n${(dossier.recent_messages || []).map((m) => m.body).join("\n")}`.toLowerCase();
          if (/\b(still gathering|more work remains|keep this open|still exploring)\b/.test(blob)) {
            return { thread_id: dossier.thread_id, status: "keep", reason: "Mock Skipper: work still open." };
          }
          if (/\b(done|complete|finished|resolved|all set|answer complete)\b/.test(blob) && !/\b(still need|waiting|blocked|more work)\b/.test(blob)) {
            return { thread_id: dossier.thread_id, status: "resolved", reason: "Mock Skipper: outcome is clearly complete." };
          }
          if (/\b(waiting (on|for)|need your|please confirm|blocked)\b/.test(blob)) {
            return { thread_id: dossier.thread_id, status: "waiting", reason: "Mock Skipper: blocked on human input." };
          }
          return { thread_id: dossier.thread_id, status: "keep", reason: "Mock Skipper: leave as-is." };
        }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 },
      }));
    }

    res.writeHead(200, { "content-type": "text/event-stream" });
    if ((wantsCurrentEventResearch || wantsRealEventImage) && !webSearchResult) {
      const args = { query: "Sunset Boulevard sinkhole water main West Hollywood", category: "news", limit: 5 };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "search_web_event_1", type: "function", function: { name: "search_web", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsRealEventImage && webSearchResult && !webImageResult) {
      const args = { image_url: "https://example.com/images/sunset-sinkhole.jpg", source_url: "https://example.com/news/sunset-sinkhole", caption: "Roadway collapse on Sunset Boulevard after a water-main rupture", name: "sunset-boulevard-road-collapse" };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "attach_web_image_event_1", type: "function", function: { name: "attach_web_image", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCurrentEventResearch && webSearchResult && !webInspectResult) {
      const args = { url: "https://example.com/news/sunset-sinkhole" };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "inspect_web_event_1", type: "function", function: { name: "inspect_web_source", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsRealEventImage && webImageResult) {
      sse(res, { choices: [{ delta: { content: "I attached a real news image of the Sunset Boulevard roadway collapse, not an AI-generated reconstruction. Source: Example News — https://example.com/news/sunset-sinkhole. Answer complete." } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    } else if (wantsCurrentEventResearch && webSearchResult && webInspectResult) {
      sse(res, { choices: [{ delta: { content: "The latest sourced report says a broken water main washed supporting soil from beneath Sunset Boulevard in West Hollywood, producing the sinkhole-shaped roadway collapse seen online. Officials describe the confirmed cause as a water-main break; “sinkhole” describes the visible result. The report says the road reopened after crews repaired the main and filled and stabilized the void. Source: Example News, published July 23, 2026 — https://example.com/news/sunset-sinkhole. Answer complete." } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    } else if (wantsInspectLearnSource) {
      const url = latestUser.match(/https:\/\/[^\s)\]}>]+/i)?.[0] || "https://example.com/source";
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "inspect_web_source_1", type: "function", function: { name: "inspect_web_source", arguments: JSON.stringify({ url }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsLearnSkill || inspectedLearnSource) {
      const openTerminal = /open terminal|open-terminal|openterminal/i.test(`${latestUser}\n${inspectedLearnSource?.content || ""}`);
      const args = openTerminal
        ? { name: "Open Terminal safe deployment", description: "Deploy and verify Open Terminal without unintended host or network exposure.", instructions: "Use when deploying Open Terminal for an agent or automation workflow. Prefer a dedicated Docker container and persistent volume over bare metal because bare-metal commands inherit the service user's host permissions. Require a strong API key, bind or publish only to the network scope the client actually needs, and never mount the Docker socket unless the user explicitly accepts effective host-root control. Treat file_browser_root as a client UI hint, not a security boundary. Verify the exact image or package provenance, start the service, check its health and API docs, execute only a harmless command, verify authentication rejects an invalid key, inspect the listener and logs, and document the pinned update, rollback, and removal procedure. Do not treat single-container multi-user mode as hard production isolation; use one container per trust boundary when users are not mutually trusted." }
        : { name: "Incident postmortem", description: "Turn incident evidence into reusable postmortems.", instructions: "Gather the timeline, contributing factors, corrective actions, owners, and follow-up dates." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "create_skill_1", type: "function", function: { name: "create_skill", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsGmailConnect) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "connect_gmail_1", type: "function", function: { name: "connect_gmail", arguments: JSON.stringify({ start: false }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (asksAvailability) {
      sse(res, { choices: [{ delta: { content: "I checked the capabilities available in this workspace and answered without installing or opening an interview. Answer complete." } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    } else if (wantsAskUser) {
      const args = { blocker_kind: "human_judgment", evidence: "The requested interview explicitly asks the human to choose between materially different approaches.", intro: "Choose how I should proceed.", questions: [{ header: "Approach", question: "Which approach should I use?", options: [{ label: "Fast", description: "Prefer speed." }, { label: "Thorough", description: "Prefer depth." }] }] };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "ask_user_1", type: "function", function: { name: "ask_user", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsRequestSkill) {
      const args = { skill: "self-hosting-guide", reason: "The current work benefits from approachable self-hosting guidance." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "request_skill_1", type: "function", function: { name: "request_skill", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsProposeSkill) {
      const args = { name: "Meeting brief", description: "Turn meeting context into a concise pre-read, decisions, and follow-ups.", instructions: "Activate before a meeting when agenda, participants, source notes, or prior decisions are available. Gather the authoritative context and distinguish sourced facts from open questions. Produce a compact brief with objective, participants, relevant history, decision points, risks, and required preparation. After the meeting, capture decisions with owners and dates, link the source artifacts, schedule durable follow-ups for unfinished actions, and verify that every stated commitment is represented in the final record.", evidence: "The completed launch meeting brief was attached in the thread and every decision, owner, and due date matched the source notes.", rationale: "This verified workflow is reusable across future meetings." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "propose_skill_1", type: "function", function: { name: "propose_skill", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsInviteAgent || wantsDuplicateInvite) {
      const args = { agent: "finance-agent", reason: "Review the financial implications in this one thread." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "invite_agent_1", type: "function", function: { name: "invite_agent", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCallAgent || forcesForbiddenMainCall) {
      const args = { reason: "Credentials are ready in /workspace/.secrets/media-stack.env. Continue the original request and finish it." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_agent_1", type: "function", function: { name: "call_agent", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsScheduleFollowup) {
      const args = { delay_seconds: /browser follow-up countdown/i.test(latestUser) ? 300 : 30, reason: "Check whether the async download finished and report Downloaded or Blocked.", user_update: { completed: "The download was started successfully.", observed_state: "The transfer process is directly confirmed running.", wait_reason: "The transfer must finish before its output can be verified.", next_check: "Inspect the process and downloaded file." } };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "schedule_followup_1", type: "function", function: { name: "schedule_followup", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsResidentNetworkSetup) {
      const args = { command: "printf 'socket Permission denied\\n' >&2; exit 1" };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "resident_network_probe_1", type: "function", function: { name: "run_command", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsResidentNetworkEscalation) {
      const args = { reason: "Original outcome: set up Jellyfin locally. Resident network probe failed at socket creation with Permission denied, a machine boundary. Inspect and repair resident-computer networking, then return the verified boundary result so I can finish the setup." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "resident_network_skipper_1", type: "function", function: { name: "call_skipper", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsAutonomousInstall) {
      const args = { command: "printf 'codex installed\\n' > codex-install.txt" };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "install_codex_1", type: "function", function: { name: "run_command", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCallSkipper) {
      const toolName = "call_skipper", args = { reason: "need host whoami" };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_skip", type: "function", function: { name: toolName, arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(0, -1) } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsListChannels) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "list_channels_1", type: "function", function: { name: "list_channels", arguments: JSON.stringify({ include_archived: true }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsReconcileFleet) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "reconcile_fleet_1", type: "function", function: { name: "care_for_channel_computer", arguments: JSON.stringify({ action: "reconcile" }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsDeleteChannel) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "delete_channel_1", type: "function", function: { name: "delete_channel", arguments: JSON.stringify({ channel: "ideas", confirmation: "ideas" }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsArchiveChannel) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "archive_channel_1", type: "function", function: { name: "archive_channel", arguments: JSON.stringify({ channel: "ideas" }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCreateChannel) {
      const requestedName = latestUser.match(/(?:called|named)\s+["']?([a-z0-9_-]+)/i)?.[1] || "emails";
      const toolName = "create_channel", args = { name: requestedName };
      sse(res, { choices: [{ delta: { content: "I'll inspect /root and run commands to figure this out. " } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "create_channel_1", type: "function", function: { name: toolName, arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsTool) {
      const command = /slow-turn/i.test(latestUser) ? "touch should-not-exist" : /launch-plan/i.test(latestUser) ? "printf 'Launch plan from resident agent\\n' > launch-plan.md" : "whoami";
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_command", arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command }).slice(0, -1) } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (auditMode) {
      // Stream path for audit (fallback).
      const dossiers = (() => {
        try {
          const user = [...reqBody.messages].reverse().find((message) => message.role === "user")?.content || "";
          const jsonStart = user.indexOf("[");
          return jsonStart >= 0 ? JSON.parse(user.slice(jsonStart)) : [];
        } catch { return []; }
      })();
      const decisions = (Array.isArray(dossiers) ? dossiers : []).map((dossier) => {
        const blob = `${dossier.title || ""}\n${dossier.summary || ""}\n${(dossier.recent_messages || []).map((m) => m.body).join("\n")}`.toLowerCase();
        if (/\b(done|complete|finished|resolved|all set|answer complete)\b/.test(blob) && !/\b(still need|waiting|blocked)\b/.test(blob)) {
          return { thread_id: dossier.thread_id, status: "resolved", reason: "Mock Skipper: outcome is clearly complete." };
        }
        if (/\b(waiting (on|for)|need your|please confirm|blocked)\b/.test(blob)) {
          return { thread_id: dossier.thread_id, status: "waiting", reason: "Mock Skipper: blocked on human input." };
        }
        return { thread_id: dossier.thread_id, status: "keep", reason: "Mock Skipper: leave as-is." };
      });
      const text = JSON.stringify(decisions);
      for (const tok of text.match(/.{1,24}/g) || [text]) sse(res, { choices: [{ delta: { content: tok } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    } else {
      const memory = /launch-on-monday/i.test(serialized) ? " I remember the decision: launch-on-monday." : "";
      const text = /live-ui-stream/i.test(latestUser)
        ? "Live stream update keeps the active composer stable while progress arrives. Answer complete."
        : `Model **${reqBody.model}** here.${memory} Answer complete.`;
      for (const tok of text.match(/.{1,6}/g)) {
        sse(res, { choices: [{ delta: { content: tok } }] });
        if (/live-ui-stream/i.test(latestUser)) await new Promise((resolve) => setTimeout(resolve, 90));
      }
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    // Rough usage for stream_options.include_usage consumers (OpenAI-compatible).
    const approxIn = Math.max(12, Math.ceil(serialized.length / 4));
    const approxOut = Math.max(4, Math.ceil(String(reqBody.model || "").length + 24));
    sse(res, { choices: [], usage: { prompt_tokens: approxIn, completion_tokens: approxOut, total_tokens: approxIn + approxOut } });
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  res.writeHead(404).end("no");
}).listen(PORT, () => console.log("mock-openai on " + PORT));
