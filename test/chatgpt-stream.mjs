import assert from "node:assert/strict";
import test from "node:test";

import { readChatGPTCompletionStream } from "../src/server/chatgpt.ts";

test("ChatGPT stream errors fail the turn instead of becoming an empty answer", async () => {
  const failure = { type: "error", code: "stream_error", message: "Request blocked." };
  const response = new Response(`event: error\ndata: ${JSON.stringify(failure)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });

  await assert.rejects(readChatGPTCompletionStream(response, () => undefined),
    /ChatGPT stream failed: Request blocked\./);
});
