import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("ChatGPT image generation sends the Responses built-in tool and accepts streamed image output", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-chatgpt-image-"));
  process.env.CTRL_DATA_DIR = dataDir;
  const { generateChatGPTImageWith } = await import(`../src/server/chatgpt.ts?image-test=${Date.now()}`);
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(128, 7)]);
  let requestBody;
  const handler = {
    async handler(request) {
      requestBody = await request.json();
      const completed = { type: "response.completed", response: { output: [{ type: "image_generation_call", result: png.toString("base64") }] } };
      return new Response(`event: response.completed\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  };
  const result = await generateChatGPTImageWith(handler, ["gpt-5.6"], "Draw a calm helm at sea", undefined,
    (path, init) => new Request(`http://chatgpt.local/api/chatgpt${path}`, init));
  assert.deepEqual(result, png);
  assert.equal(requestBody.model, "gpt-5.6");
  assert.deepEqual(requestBody.tools, [{ type: "image_generation", action: "generate" }]);
  assert.equal(requestBody.input, "Draw a calm helm at sea");
});
