import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const suiteDataDir = await mkdtemp(join(tmpdir(), "1helm-chatgpt-image-suite-"));
process.env.CTRL_DATA_DIR = suiteDataDir;
after(async () => rm(suiteDataDir, { recursive: true, force: true }));

test("ChatGPT image generation sends the Responses built-in tool and accepts streamed image output", async () => {
  const { generateChatGPTImageWith } = await import(`../src/server/chatgpt.ts?image-test=${Date.now()}`);
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

test("the connected provider fabric executes image generation and persists refreshed tokens", async () => {
  const { generateRoutingChatGPTImageWith } = await import(`../src/server/routing.ts?image-fabric-test=${Date.now()}`);
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(128, 9)]);
  const config = {
    providers: [{
      id: "prov_chatgpt_test",
      type: "chatgpt",
      name: "ChatGPT",
      enabled: true,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() + 60_000,
      models: [{ id: "gpt-5.6", enabled: true }],
    }],
    combos: [],
  };
  const store = {
    load: () => config,
    update(fn) { fn(config); },
    save() {},
  };
  let routed;
  const adapter = {
    async chat(provider, options) {
      routed = { provider, options };
      await options.onTokenRefresh({ accessToken: "new-access", refreshToken: "new-refresh" });
      const completed = { type: "response.completed", response: { output: [{ type: "image_generation_call", result: png.toString("base64") }] } };
      return { response: new Response(`event: response.completed\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }) };
    },
  };
  const result = await generateRoutingChatGPTImageWith(store, adapter, "A pelican riding a bicycle");
  assert.deepEqual(result, png);
  assert.equal(routed.provider.id, "prov_chatgpt_test");
  assert.equal(routed.options.model, "gpt-5.6");
  assert.deepEqual(routed.options.body.tools, [{ type: "image_generation", action: "generate" }]);
  assert.equal(routed.options.body.messages[0].content, "A pelican riding a bicycle");
  assert.equal(config.providers[0].accessToken, "new-access");
  assert.equal(config.providers[0].refreshToken, "new-refresh");
});

test("connected ChatGPT automatically exposes Skipper image generation and attaches the PNG", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-chatgpt-image-runtime-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "test/chatgpt-image-runtime-check.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, CTRL_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
