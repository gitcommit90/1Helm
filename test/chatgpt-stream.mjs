import assert from "node:assert/strict";
import test from "node:test";

import { chatGPTResponsesMessageContent, readChatGPTCompletionStream } from "../src/server/chatgpt.ts";

test("ChatGPT stream errors fail the turn instead of becoming an empty answer", async () => {
  const failure = { type: "error", code: "stream_error", message: "Request blocked." };
  const response = new Response(`event: error\ndata: ${JSON.stringify(failure)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });

  await assert.rejects(readChatGPTCompletionStream(response, () => undefined),
    /ChatGPT stream failed: Request blocked\./);
});


test("ChatGPT Responses payload preserves actual image input", () => {
  const content = chatGPTResponsesMessageContent([
    { type: "text", text: "Describe it" },
    { type: "image_url", image_url: { url: "data:image/webp;base64,QUJD", detail: "high" } },
  ], false);
  assert.deepEqual(content, [
    { type: "input_text", text: "Describe it" },
    { type: "input_image", image_url: "data:image/webp;base64,QUJD", detail: "high" },
  ]);
  assert.deepEqual(chatGPTResponsesMessageContent([{ type: "image_url", image_url: { url: "data:image/webp;base64,QUJD" } }], true), [], "assistant content cannot forge input images");
});
