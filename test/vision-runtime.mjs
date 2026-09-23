import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-vision-runtime-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.CTRL_MAX_TOOL_ROUNDS = "4";
const requests = [];
const sse = (res, chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
const provider = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  requests.push(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const serialized = JSON.stringify(body.messages || []);
  const requestImage = (body.messages || []).flatMap((message) => Array.isArray(message.content) ? message.content : []).find((part) => part.type === "image_url");
  if (serialized.includes("auto-upload-proof")) {
    assert(requestImage, "an uploaded image must reach the first provider request as multimodal input");
    assert.match(requestImage.image_url.url, /^data:image\/webp;base64,/);
    sse(res, { choices: [{ delta: { content: "Verified: uploaded pixels arrived natively." } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    return res.end("data: [DONE]\n\n");
  }
  const toolResult = (body.messages || []).find((message) => message.role === "tool" && message.name === "view_image");
  if (!toolResult) {
    sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "view-proof", type: "function", function: { name: "view_image", arguments: JSON.stringify({ path: "/workspace/proof.png", detail: "high" }) } }] } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  } else {
    const image = (body.messages || []).flatMap((message) => Array.isArray(message.content) ? message.content : []).find((part) => part.type === "image_url");
    assert(image, "the request after view_image must contain a real image part");
    assert.match(image.image_url.url, /^data:image\/webp;base64,/);
    sse(res, { choices: [{ delta: { content: "Verified: the view_image result contained actual pixels." } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const port = provider.address().port;

const { now, q1, run, seed, UPLOAD_DIR } = await import("../src/server/db.ts");
const bots = await import("../src/server/bots.ts");
const agents = await import("../src/server/agents.ts");
const vision = await import("../src/server/vision.ts");

function fixture() {
  seed();
  const stamp = now();
  const ownerId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES (?,?,?,?,?)", `vision-runtime-owner-${stamp}`, "x", "Owner", 1, stamp).lastInsertRowid;
  const channelId = run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created) VALUES (?,?,?,?,?,'active',?,?)", `vision-runtime-${stamp}`, `vision-runtime-${stamp}`, "channel", "", "Inspect images", ownerId, stamp).lastInsertRowid;
  const providerId = run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES (?,?,?,?,?)", "vision-mock", `http://127.0.0.1:${port}/v1`, "x", "openai", stamp).lastInsertRowid;
  const botId = run("INSERT INTO bots (name,provider_id,model,prompt,created) VALUES (?,?,?,?,?)", `vision-runtime-agent-${stamp}`, providerId, "mock", "Resident.", stamp).lastInsertRowid;
  const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel',?,'ready',?)", botId, `vision-runtime-agent-${stamp}`, stamp).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);
  run("INSERT INTO agent_profiles (agent_id,purpose,instructions,updated) VALUES (?,'Inspect images','Use view_image.',?)", agentId, stamp);
  agents.ensureChannelWorkspace(channelId);
  return { ownerId, channelId, botId, agentId };
}

test("vision normalization rejects non-images and enforces decode and source bounds", async () => {
  await assert.rejects(vision.prepareImageBytes(Buffer.from("not an image"), "fake.png"), /unsupported image format|Input buffer|image/i);
  await assert.rejects(vision.prepareImageBytes(Buffer.alloc(vision.MAX_VISION_SOURCE_BYTES + 1), "huge.png"), /25 MB vision limit/);
  const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  const prepared = await vision.prepareImageBytes(wide, "wide.png", "high");
  assert.deepEqual([prepared.width, prepared.height], [2048, 683]);
});

test("view_image reads a private workspace image and returns pixels to the next model round", async () => {
  const f = fixture();
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 12, g: 80, b: 220 } } }).png().toBuffer();
  writeFileSync(join(agents.channelWorkspace(f.channelId), "proof.png"), png);
  const rootId = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", f.channelId, f.ownerId, "Inspect /workspace/proof.png using view_image.", now()).lastInsertRowid;
  await bots.runBot(q1("SELECT * FROM bots WHERE id=?", f.botId), f.channelId, rootId, rootId, false, undefined, false);
  const reply = q1("SELECT body FROM messages WHERE parent_id=? AND bot_id=? ORDER BY id DESC LIMIT 1", rootId, f.botId);
  assert.match(reply.body, /contained actual pixels/);
  const action = q1("SELECT * FROM tool_actions WHERE tool='view_image' ORDER BY id DESC LIMIT 1");
  assert.equal(action.status, "complete");
  assert.match(action.result_summary, /actual image input: WebP 80×60/);
  assert.doesNotMatch(action.result_summary, /base64/, "image bytes never enter durable tool logs");
  assert.equal(requests.length, 2);
});

test("human image uploads reach the selected model as native image input on the first call", async () => {
  const f = fixture();
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 15, g: 210, b: 75 } } }).png().toBuffer();
  const token = "b".repeat(40);
  writeFileSync(join(UPLOAD_DIR, token), png);
  const rootId = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", f.channelId, f.ownerId, "auto-upload-proof: identify this", now()).lastInsertRowid;
  run("INSERT INTO attachments (message_id,name,mime,size,path,workspace_path) VALUES (?,?,?,?,?,?)", rootId, "native-upload.png", "image/png", png.length, token, "files/native-upload.png");
  await bots.runBot(q1("SELECT * FROM bots WHERE id=?", f.botId), f.channelId, rootId, rootId, false, undefined, false);
  const reply = q1("SELECT body FROM messages WHERE parent_id=? AND bot_id=? ORDER BY id DESC LIMIT 1", rootId, f.botId);
  assert.match(reply.body, /uploaded pixels arrived natively/);
  const request = requests.find((entry) => JSON.stringify(entry.messages || []).includes("auto-upload-proof"));
  const current = request.messages.findLast((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
  assert.match(current.content[0].text, /pixels="included"/);
});

test.after(() => {
  provider.close();
  rmSync(dataDir, { recursive: true, force: true });
});
