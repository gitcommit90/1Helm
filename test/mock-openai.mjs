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
    const hasToolResult = reqBody.messages.some((m) => m.role === "tool");
    const wantsTool = reqBody.tools && /run|exec|whoami|command/i.test(JSON.stringify(reqBody.messages)) && !hasToolResult;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (wantsTool) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_command", arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":"whoami"' } }] } }] });
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      const text = `Model **${reqBody.model}** here. `;
      for (const tok of (text + "Answer complete.").match(/.{1,6}/g)) sse(res, { choices: [{ delta: { content: tok } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  res.writeHead(404).end("no");
}).listen(PORT, () => console.log("mock-openai on " + PORT));
