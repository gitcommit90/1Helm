import { createServer } from "node:http";

// Minimal OpenAI-compatible mock: /models + streaming /chat/completions with tool calling.
const PORT = Number(process.argv[2] || 9099);

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-large" }, { id: "mock-small" }] }));
  }
  if (url.pathname.endsWith("/chat/completions")) {
    let raw = ""; for await (const c of req) raw += c;
    const reqBody = JSON.parse(raw || "{}");
    const serialized = JSON.stringify(reqBody.messages);
    const latestUser = [...reqBody.messages].reverse().find((message) => message.role === "user")?.content || "";
    if (/slow-turn/i.test(serialized)) await new Promise((resolve) => setTimeout(resolve, 1200));
    const hasToolResult = reqBody.messages.some((m) => m.role === "tool");
    const repeatsTools = /repeat-tool-limit/i.test(serialized);
    const wantsRequestSkill = reqBody.tools?.some((tool) => tool.function?.name === "request_skill") && /request the self-hosting-guide skill/i.test(latestUser) && !hasToolResult;
    const wantsProposeSkill = reqBody.tools?.some((tool) => tool.function?.name === "propose_skill") && /propose a reusable meeting brief skill/i.test(latestUser) && !hasToolResult;
    const wantsInviteAgent = reqBody.tools?.some((tool) => tool.function?.name === "invite_agent") && /invite @?finance-agent/i.test(latestUser) && !hasToolResult;
    const wantsCallSkipper = reqBody.tools && /call skipper to run whoami/i.test(serialized) && !hasToolResult && /You are @\S+-agent/.test(serialized);
    const wantsCreateChannel = reqBody.tools?.some((tool) => tool.function?.name === "create_channel") && /create (?:a )?(?:new )?channel/i.test(serialized) && !hasToolResult;
    const wantsTool = reqBody.tools && /run|exec|whoami|command|create .*file|launch-plan/i.test(serialized) && (!hasToolResult || repeatsTools) && !wantsCallSkipper;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (wantsRequestSkill) {
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
    } else {
      const memory = /launch-on-monday/i.test(serialized) ? " I remember the decision: launch-on-monday." : "";
      const text = `Model **${reqBody.model}** here.${memory} `;
      for (const tok of (text + "Answer complete.").match(/.{1,6}/g)) sse(res, { choices: [{ delta: { content: tok } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  res.writeHead(404).end("no");
}).listen(PORT, () => console.log("mock-openai on " + PORT));
