import { createServer } from "node:http";

// Minimal OpenAI-compatible mock: /models + streaming /chat/completions with tool calling.
const PORT = Number(process.argv[2] || 9099);

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
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
    if (url.pathname.includes("/always-fail/")) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Mock upstream unavailable", type: "api_error" } }));
    }
    const routeMarker = ["fallback-backup", "round-a", "round-b"].find((marker) => url.pathname.includes(`/${marker}/`));
    const serialized = JSON.stringify(reqBody.messages);
    const latestUser = [...reqBody.messages].reverse().find((message) => message.role === "user")?.content || "";
    if (/slow-turn/i.test(serialized)) await new Promise((resolve) => setTimeout(resolve, 1200));
    if (/live-ui-stream/i.test(latestUser)) await new Promise((resolve) => setTimeout(resolve, 250));
    const hasToolResult = reqBody.messages.some((m) => m.role === "tool");
    const repeatsTools = /repeat-tool-limit/i.test(serialized);
    const wantsRequestSkill = reqBody.tools?.some((tool) => tool.function?.name === "request_skill") && /request the self-hosting-guide skill/i.test(latestUser) && !hasToolResult;
    const wantsProposeSkill = reqBody.tools?.some((tool) => tool.function?.name === "propose_skill") && /propose a reusable meeting brief skill/i.test(latestUser) && !hasToolResult;
    const wantsInviteAgent = reqBody.tools?.some((tool) => tool.function?.name === "invite_agent") && /invite @?finance-agent/i.test(latestUser) && !hasToolResult;
    // Match the Captain/user turn only — system prompts now mention call_agent/hand-back and must not steal other tool paths.
    const wantsCallAgent = reqBody.tools?.some((tool) => tool.function?.name === "call_agent")
      && /hand (?:the )?work back|call_agent|re-invoke|handoff to resident/i.test(latestUser)
      && !hasToolResult
      && /You are @skipper/i.test(serialized);
    // Durable follow-up: resident must schedule when async work continues after the turn.
    const wantsScheduleFollowup = reqBody.tools?.some((tool) => tool.function?.name === "schedule_followup")
      && /schedule[_ ]followup|check later|still downloading|async download|wake me/i.test(latestUser)
      && !hasToolResult
      && /You are @\S+-agent/.test(serialized);
    const wantsAskUser = reqBody.tools?.some((tool) => tool.function?.name === "ask_user")
      && /structured interview|ask me structured|multiple choice/i.test(latestUser)
      && !hasToolResult;
    const wantsLearnSkill = reqBody.tools?.some((tool) => tool.function?.name === "create_skill")
      && /Learn one new reusable workspace skill/i.test(latestUser)
      && !hasToolResult;
    const wantsCallSkipper = reqBody.tools && /call skipper to run whoami/i.test(serialized) && !hasToolResult && /You are @\S+-agent/.test(serialized);
    const wantsCreateChannel = reqBody.tools?.some((tool) => tool.function?.name === "create_channel") && /create (?:a )?(?:new )?channel/i.test(serialized) && !hasToolResult;
    const wantsTool = reqBody.tools && /run|exec|whoami|command|create .*file|launch-plan/i.test(serialized) && (!hasToolResult || repeatsTools) && !wantsCallSkipper && !wantsCallAgent && !wantsCreateChannel && !wantsScheduleFollowup;
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
    if (wantsLearnSkill) {
      const args = { name: "Incident postmortem", description: "Turn incident evidence into reusable postmortems.", instructions: "Gather the timeline, contributing factors, corrective actions, owners, and follow-up dates." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "create_skill_1", type: "function", function: { name: "create_skill", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsAskUser) {
      const args = { intro: "Choose how I should proceed.", questions: [{ header: "Approach", question: "Which approach should I use?", options: [{ label: "Fast", description: "Prefer speed." }, { label: "Thorough", description: "Prefer depth." }] }] };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "ask_user_1", type: "function", function: { name: "ask_user", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsRequestSkill) {
      const args = { skill: "self-hosting-guide", reason: "The current work benefits from approachable self-hosting guidance." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "request_skill_1", type: "function", function: { name: "request_skill", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsProposeSkill) {
      const args = { name: "Meeting brief", description: "Turn meeting context into a concise pre-read, decisions, and follow-ups.", rationale: "This workflow is reusable across future meetings." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "propose_skill_1", type: "function", function: { name: "propose_skill", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsInviteAgent) {
      const args = { agent: "finance-agent", reason: "Review the financial implications in this one thread." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "invite_agent_1", type: "function", function: { name: "invite_agent", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCallAgent) {
      const args = { reason: "Credentials are ready in /workspace/.secrets/media-stack.env. Continue the original request and finish it." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_agent_1", type: "function", function: { name: "call_agent", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsScheduleFollowup) {
      const args = { delay_seconds: 30, reason: "Check whether the async download finished and report Downloaded or Blocked." };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "schedule_followup_1", type: "function", function: { name: "schedule_followup", arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCallSkipper) {
      const toolName = "call_skipper", args = { reason: "need host whoami" };
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_skip", type: "function", function: { name: toolName, arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(0, -1) } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsCreateChannel) {
      const toolName = "create_channel", args = { name: "emails" };
      sse(res, { choices: [{ delta: { content: "I'll inspect /root and run commands to figure this out. " } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "create_channel_1", type: "function", function: { name: toolName, arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else if (wantsTool) {
      const command = /slow-turn/i.test(serialized) ? "touch should-not-exist" : /launch-plan/i.test(serialized) ? "printf 'Launch plan from resident agent\\n' > launch-plan.md" : "whoami";
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
